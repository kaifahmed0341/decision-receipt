import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReceipt, checkPage, withRetry, retryDelayMs, ReceiptError, MAX_WAIT_MS } from '../src/lib/receipt.js';

const SITE = 'demo.atlassian.net';
const res = (status, body, headers = {}) => ({
  status,
  headers: { get: (n) => (n.toLowerCase() in headers ? headers[n.toLowerCase()] : null) },
  json: async () => body,
});
const page = (id, title, html, status = 'current', version = 2) => ({
  id,
  title,
  status,
  version: { number: version, createdAt: '2026-11-10T08:00:00Z' },
  body: { storage: { value: html } },
});
const link = (pageId) => ({
  id: Number(pageId),
  globalId: `appId=x&pageId=${pageId}`,
  application: { type: 'com.atlassian.confluence' },
  object: { url: `https://${SITE}/wiki/spaces/D/pages/${pageId}`, title: `Title ${pageId}` },
});

function fakeHttp({ issue = res(200, { key: 'DREC-1', fields: { summary: 'Remove the v1 CSV export endpoint' } }), links = res(200, []), pages = {} } = {}) {
  const calls = { pages: [], sleeps: [] };
  return {
    calls,
    issue: async () => issue,
    remoteLinks: async () => links,
    confluencePage: async (id) => {
      calls.pages.push(id);
      const p = pages[id];
      if (typeof p === 'function') return p();
      return p || res(404, {});
    },
    now: () => new Date('2026-11-16T12:00:00Z'),
    sleep: async (ms) => {
      calls.sleeps.push(ms);
    },
  };
}

test('retry waits as Retry-After asks, capped, then gives up', async () => {
  assert.equal(retryDelayMs(res(429, {}, { 'retry-after': '1' }), 0), 1000);
  assert.equal(retryDelayMs(res(429, {}, { 'retry-after': '60' }), 0), MAX_WAIT_MS);
  assert.equal(retryDelayMs(res(429, {}), 1), 1000);
  const http = fakeHttp();
  let n = 0;
  const out = await withRetry(async () => (++n < 3 ? res(429, {}, { 'retry-after': '1' }) : res(200, {})), http);
  assert.equal(out.status, 200);
  assert.deepEqual(http.calls.sleeps, [1000, 1000]);
  n = 0;
  const stuck = await withRetry(async () => { n += 1; return res(429, {}); }, http);
  assert.equal(stuck.status, 429);
  assert.equal(n, 3);
});

test('errors thrown by the platform, such as a consent request, are not swallowed', async () => {
  const http = fakeHttp({ links: res(200, [link('7')]) });
  http.confluencePage = async () => {
    const e = new Error('needs auth');
    e.name = 'NEEDS_AUTHENTICATION_ERR';
    throw e;
  };
  await assert.rejects(buildReceipt('DREC-1', SITE, http), { name: 'NEEDS_AUTHENTICATION_ERR' });
});

test('a denied or deleted page shows no title, url or text', async () => {
  for (const status of [403, 404]) {
    const http = fakeHttp({ links: res(200, [link('7')]), pages: { 7: res(status, { title: 'Secret plan' }) } });
    const { receipt: r } = await buildReceipt('DREC-1', SITE, http);
    assert.equal(r.pages[0].status, 'unavailable');
    assert.ok(!JSON.stringify(r).includes('Secret plan'));
    assert.ok(!JSON.stringify(r).includes('Title 7'));
    assert.ok(!JSON.stringify(r).includes('/pages/7'));
    assert.equal(r.overall, 'unchecked');
  }
});

test('a trashed page does not count as evidence', async () => {
  const http = fakeHttp({ links: res(200, [link('8')]), pages: { 8: res(200, page('8', 'Old', '<p>Approved DREC-1.</p>', 'trashed')) } });
  const { receipt: r } = await buildReceipt('DREC-1', SITE, http);
  assert.equal(r.pages[0].status, 'not-current');
  assert.ok(!JSON.stringify(r).includes('Approved DREC-1'));
});

test('a page still rate limited after retries is reported, not guessed', async () => {
  const http = fakeHttp({ links: res(200, [link('9')]), pages: { 9: res(429, {}, { 'retry-after': '1' }) } });
  const { receipt: r } = await buildReceipt('DREC-1', SITE, http);
  assert.equal(r.pages[0].status, 'rate-limited');
  assert.equal(http.calls.pages.length, 3);
});

test('an unexpected Confluence status is an error, not a verdict', async () => {
  const http = fakeHttp({ links: res(200, [link('9')]), pages: { 9: res(500, {}) } });
  const r = await checkPage({ pageId: '9', url: 'u' }, { key: 'DREC-1', summary: 's' }, http);
  assert.equal(r.status, 'error');
});

test('issue-level failures become plain messages', async () => {
  await assert.rejects(buildReceipt('not a key', SITE, fakeHttp()), (e) => e instanceof ReceiptError && e.code === 'bad-issue');
  await assert.rejects(buildReceipt('DREC-1', SITE, fakeHttp({ issue: res(404, {}) })), (e) => e.code === 'issue-unavailable');
  await assert.rejects(buildReceipt('DREC-1', SITE, fakeHttp({ issue: res(429, {}) })), (e) => e.code === 'rate-limited');
  await assert.rejects(buildReceipt('DREC-1', SITE, fakeHttp({ links: res(500, {}) })), (e) => e.code === 'jira-error');
});

test('a receipt records when it was checked and quotes the page exactly', async () => {
  const html = '<p>Approved on 4 November: we remove the v1 CSV export endpoint (DREC-1).</p>';
  const http = fakeHttp({ links: res(200, [link('5')]), pages: { 5: res(200, page('5', 'Decision', html, 'current', 4)) } });
  const { receipt: r } = await buildReceipt('DREC-1', SITE, http);
  assert.equal(r.overall, 'all-support');
  assert.equal(r.checkedAt, '2026-11-16T12:00:00.000Z');
  assert.equal(r.pages[0].version, 4);
  assert.equal(r.pages[0].excerpts[0].text, 'Approved on 4 November: we remove the v1 CSV export endpoint (DREC-1).');
  assert.match(r.pages[0].provenance, /^Version 4, last edited 10 Nov 2026, 08:00:00 UTC\. Retrieved 16 Nov 2026, 12:00:00 UTC\.$/);
});

test('a request that throws is reported as interrupted, without page details', async () => {
  const http = fakeHttp({ links: res(200, [link('7')]) });
  http.confluencePage = async () => {
    throw new Error('socket hang up');
  };
  const { receipt, fingerprint } = await buildReceipt('DREC-1', SITE, http);
  assert.equal(receipt.pages[0].status, 'interrupted');
  assert.match(receipt.pages[0].message, /did not complete/);
  assert.equal(receipt.pages[0].title, undefined);
  assert.equal(receipt.overall, 'unchecked');
  assert.deepEqual(fingerprint, [{ pageId: '7', status: 'interrupted', version: null, verdict: null }]);
});

test('pages after the time budget are reported as not read', async () => {
  const http = fakeHttp({
    links: res(200, [link('1'), link('2')]),
    pages: { 1: res(200, page('1', 'One', '<p>DREC-1 approved.</p>')), 2: res(200, page('2', 'Two', '<p>DREC-1 approved.</p>')) },
  });
  let t = Date.parse('2026-11-16T12:00:00Z');
  http.now = () => new Date(t);
  const original = http.confluencePage;
  http.confluencePage = async (id) => {
    t += 30000; // each read takes 30 seconds
    return original(id);
  };
  const { receipt } = await buildReceipt('DREC-1', SITE, http, { budgetMs: 18000 });
  assert.equal(receipt.pages[0].status, 'ok');
  assert.equal(receipt.pages[1].status, 'timed-out');
  assert.equal(receipt.overall, 'incomplete');
});

test('the fingerprint keeps hidden page ids on the server side only', async () => {
  const http = fakeHttp({ links: res(200, [link('7')]), pages: { 7: res(404, {}) } });
  const { receipt, fingerprint } = await buildReceipt('DREC-1', SITE, http);
  assert.equal(fingerprint[0].pageId, '7');
  assert.ok(!JSON.stringify(receipt).includes('"7"'));
});
