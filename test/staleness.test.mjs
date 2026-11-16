import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordKey, fingerprintOf, compareWithRecord, makeRecord, RECORD_VERSION } from '../src/lib/staleness.js';
import { loadReview, recordReview, fingerprintHash } from '../src/lib/review.js';

const ok = (pageId, version, verdict) => ({ pageId, status: 'ok', version, verdict });
const rec = (pages) => makeRecord({ checkedAt: '2026-11-16T10:00:00Z', overall: 'x' }, fingerprintOf(pages));

test('record keys separate site, issue and user and use safe characters', () => {
  const k = recordKey('cloud-1', '10001', '557058:abc-def');
  assert.equal(k, `check.v${RECORD_VERSION}:cloud-1:10001:557058:abc-def`);
  assert.notEqual(k, recordKey('cloud-1', '10001', 'someone-else'));
  assert.match(recordKey('a b', 'c/d', 'e?f'), /^[A-Za-z0-9:.-]+$/);
});

test('a record holds ids, statuses, versions and verdicts only', () => {
  const r = rec([{ ...ok('1', 2, 'supports'), title: 'Secret', excerpts: [{ text: 'quote' }] }]);
  assert.deepEqual(r.pages, [{ pageId: '1', status: 'ok', version: 2, verdict: 'supports' }]);
  assert.ok(!JSON.stringify(r).includes('Secret'));
  assert.ok(!JSON.stringify(r).includes('quote'));
});

test('no record, a current record, and an edited page', () => {
  assert.equal(compareWithRecord(undefined, [], {}).state, 'none');
  const record = rec([ok('1', 1, 'supports')]);
  assert.equal(compareWithRecord(record, fingerprintOf([ok('1', 1, 'supports')]), {}).state, 'current');
  const stale = compareWithRecord(record, fingerprintOf([ok('1', 2, 'conflicts')]), { 1: 'Decision page' });
  assert.equal(stale.state, 'stale');
  assert.equal(
    stale.changes[0].text,
    '"Decision page" changed from version 1 to version 2. Before, it supported the task. Now it conflicts with the task.'
  );
});

test('an edit that keeps the verdict is still stale', () => {
  const stale = compareWithRecord(rec([ok('1', 1, 'supports')]), fingerprintOf([ok('1', 2, 'supports')]), { 1: 'P' });
  assert.equal(stale.state, 'stale');
  assert.equal(stale.changes[0].text, '"P" changed from version 1 to version 2.');
});

test('added, removed, lost and regained pages make a record stale without naming hidden pages', () => {
  const record = rec([ok('1', 1, 'supports'), ok('2', 1, 'supports'), { pageId: '3', status: 'unavailable' }]);
  const now = fingerprintOf([{ pageId: '1', status: 'unavailable' }, ok('3', 4, 'supports'), ok('4', 1, 'missing')]);
  const cmp = compareWithRecord(record, now, { 3: 'Three', 4: 'Four' });
  const texts = cmp.changes.map((c) => c.text);
  assert.equal(cmp.state, 'stale');
  assert.ok(texts.includes('A linked page you could read at your recorded check cannot be read now.'));
  assert.ok(texts.includes('"Three" could not be read at your recorded check and can be read now.'));
  assert.ok(texts.includes('"Four" was linked after your recorded check.'));
  assert.ok(texts.includes('1 page linked at your recorded check is no longer linked.'));
});

test('a record from an older format is ignored', () => {
  assert.equal(compareWithRecord({ v: 0, pages: [] }, [], {}).state, 'none');
});

// Review flow over a fake site and a Map store.
const SITE = 'demo.atlassian.net';
const res = (status, body) => ({ status, headers: { get: () => null }, json: async () => body });
function site(version, text = '<p>DREC-1 approved.</p>') {
  return {
    issue: async () => res(200, { key: 'DREC-1', fields: { summary: 'Remove the v1 CSV export endpoint' } }),
    remoteLinks: async () =>
      res(200, [{ globalId: 'pageId=5', application: { type: 'com.atlassian.confluence' }, object: { url: `https://${SITE}/wiki/spaces/D/pages/5` } }]),
    confluencePage: async () =>
      res(200, { id: '5', title: 'Decision', status: 'current', version: { number: version, createdAt: '2026-11-16T09:00:00Z' }, body: { storage: { value: text } } }),
    now: () => new Date('2026-11-16T12:00:00Z'),
    sleep: async () => {},
  };
}
function mapStore() {
  const m = new Map();
  return { m, get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v) };
}
const ctx = (accountId) => ({ issueKey: 'DREC-1', issueId: '10001', siteHost: SITE, cloudId: 'c1', accountId });

test('record, then an edit makes the check stale until a fresh record', async () => {
  const store = mapStore();
  const first = await loadReview(ctx('kaif'), site(1), store);
  assert.equal(first.record.state, 'none');
  const saved = await recordReview(ctx('kaif'), site(1), store, first.fingerprintHash);
  assert.equal(saved.recorded, true);
  assert.equal(saved.record.state, 'current');

  const afterEdit = await loadReview(ctx('kaif'), site(2, '<p>DREC-1 is deferred.</p>'), store);
  assert.equal(afterEdit.record.state, 'stale');
  assert.equal(afterEdit.record.label, 'Recorded check is stale');
  assert.match(afterEdit.record.changes[0], /changed from version 1 to version 2/);
  // Opening the panel again does not clear the stale state.
  const again = await loadReview(ctx('kaif'), site(2, '<p>DREC-1 is deferred.</p>'), store);
  assert.equal(again.record.state, 'stale');

  const fresh = await recordReview(ctx('kaif'), site(2, '<p>DREC-1 is deferred.</p>'), store, again.fingerprintHash);
  assert.equal(fresh.recorded, true);
  assert.equal(fresh.record.state, 'current');
});

test('recording is refused when the page changed while the reviewer read it', async () => {
  const store = mapStore();
  const seen = await loadReview(ctx('kaif'), site(1), store);
  const refused = await recordReview(ctx('kaif'), site(2), store, seen.fingerprintHash);
  assert.equal(refused.recorded, false);
  assert.match(refused.message, /changed while you were reading/);
  assert.equal(store.m.size, 0);
});

test('recording is refused when a page was not read', async () => {
  const store = mapStore();
  const http = site(1);
  http.confluencePage = async () => res(429, {});
  const seen = await loadReview(ctx('kaif'), http, store);
  const refused = await recordReview(ctx('kaif'), http, store, seen.fingerprintHash);
  assert.equal(refused.recorded, false);
  assert.match(refused.message, /rate limit/);
  assert.equal(store.m.size, 0);
});

test('one reviewer does not see another reviewer\'s record', async () => {
  const store = mapStore();
  const seen = await loadReview(ctx('kaif'), site(1), store);
  await recordReview(ctx('kaif'), site(1), store, seen.fingerprintHash);
  const other = await loadReview(ctx('reviewer'), site(1), store);
  assert.equal(other.record.state, 'none');
});

test('the hash the panel gets matches the fingerprint and changes with the version', () => {
  const a = fingerprintHash(fingerprintOf([ok('1', 1, 'supports')]));
  assert.equal(a, fingerprintHash(fingerprintOf([ok('1', 1, 'supports')])));
  assert.notEqual(a, fingerprintHash(fingerprintOf([ok('1', 2, 'supports')])));
  assert.match(a, /^[0-9a-f]{32}$/);
});

test('change notes sent to the panel carry no page ids', async () => {
  const store = mapStore();
  const seen = await loadReview(ctx('kaif'), site(1), store);
  await recordReview(ctx('kaif'), site(1), store, seen.fingerprintHash);
  const hidden = site(1);
  hidden.confluencePage = async () => res(404, {});
  const r = await loadReview(ctx('kaif'), hidden, store);
  assert.equal(r.record.state, 'stale');
  assert.deepEqual(r.record.changes, ['A linked page you could read at your recorded check cannot be read now.']);
  assert.ok(!JSON.stringify(r.record).includes('"5"'));
});
