// The Rovo actions' views of a receipt: they copy, never judge, and never name a page
// the user cannot read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReceipt } from '../src/lib/receipt.js';
import { issueKeyFrom, receiptSummary, pageEvidence, explainPage, pickPage, RECEIPT_NOTICE } from '../src/lib/agent.js';

const SITE = 'demo.atlassian.net';
const res = (status, body) => ({ status, headers: { get: () => null }, json: async () => body });
const link = (id) => ({ globalId: `appId=x&pageId=${id}`, application: { type: 'com.atlassian.confluence' }, object: { url: `https://${SITE}/wiki/spaces/D/pages/${id}`, title: `Link title ${id}` } });
const page = (id, title, html) => res(200, { id, title, status: 'current', version: { number: 3, createdAt: '2026-11-10T08:00:00Z' }, body: { storage: { value: html } }, _links: { webui: `/spaces/D/pages/${id}` } });

async function receipt() {
  const http = {
    issue: async () => res(200, { key: 'DREC-2', id: '10002', fields: { summary: 'Switch invoice PDFs to the new renderer' } }),
    remoteLinks: async () => res(200, [link('1'), link('2'), link('3')]),
    confluencePage: async (id) =>
      ({
        1: page('1', 'Decision: invoice PDF renderer', '<p>The billing team agreed to move invoice PDFs to the new renderer (DREC-2).</p>'),
        2: page('2', 'Release review', '<p>We will not switch invoice PDFs to the new renderer until the fixes ship.</p>'),
        3: res(404, { title: 'Secret legal page' }),
      })[id],
    now: () => new Date('2026-11-16T12:00:00Z'),
    sleep: async () => {},
  };
  return (await buildReceipt('DREC-2', SITE, http)).receipt;
}

test('the issue key comes from the input, else from the issue being viewed', () => {
  assert.equal(issueKeyFrom({ issueKey: 'drec-2' }), 'DREC-2');
  assert.equal(issueKeyFrom({ issueKey: 'the second one', context: { jira: { url: 'https://s/browse/DREC-7' } } }), 'DREC-7');
  assert.equal(issueKeyFrom({ context: { jira: { issueKey: 'DREC-3' } } }), 'DREC-3');
  assert.equal(issueKeyFrom({}), null);
});

test('the summary copies verdicts and carries the notice', async () => {
  const r = await receipt();
  const s = receiptSummary(r, null);
  assert.equal(s.notice, RECEIPT_NOTICE);
  assert.equal(s.overallLabel, 'Unresolved conflict');
  assert.deepEqual(s.pages.map((p) => p.label), ['Supports the task', 'Conflicts with the task', 'Not available to you']);
  assert.equal(s.pages[2].title, null);
  assert.ok(!JSON.stringify(s).includes('Secret legal page'));
  assert.ok(!JSON.stringify(s).includes('Link title 3'));
});

test('page evidence quotes exactly, by number or by part of the title', async () => {
  const r = await receipt();
  const e = pageEvidence(r, 'release');
  assert.equal(e.page.label, 'Conflicts with the task');
  assert.equal(e.excerpts[0].quote, 'We will not switch invoice PDFs to the new renderer until the fixes ship.');
  assert.equal(pageEvidence(r, '1').page.title, 'Decision: invoice PDF renderer');
});

test('a page the user cannot read can only be named by number, and yields nothing', async () => {
  const r = await receipt();
  assert.match(pickPage(r, 'secret').error, /No readable linked page matches/);
  const hidden = pageEvidence(r, '3');
  assert.equal(hidden.page.title, null);
  assert.deepEqual(hidden.excerpts, []);
  const why = explainPage(r, '3', 3);
  assert.match(why.explanation, /was not read/);
  assert.ok(!JSON.stringify(why).includes('Secret'));
});

test('the explanation lists each finding with its rule and the rules version', async () => {
  const r = await receipt();
  const why = explainPage(r, '2', 3);
  assert.equal(why.rulesVersion, 3);
  assert.equal(why.findings[0].label, 'Conflicts');
  assert.match(why.findings[0].rule, /phrase "will not"/);
  assert.ok(why.rules.length >= 4);
});

test('an ambiguous or missing page reference asks for a number', async () => {
  const r = await receipt();
  assert.match(pageEvidence(r, '').error, /Say which linked page/);
  assert.match(pageEvidence(r, '9').error, /There are 3 linked pages/);
});
