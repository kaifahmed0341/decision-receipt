// Runs the full receipt over the fixture data with faked Atlassian responses, so the
// verdicts promised in fixtures/data.mjs are checked against the real rule set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, ISSUES, PROJECT } from '../fixtures/data.mjs';
import { buildReceipt } from '../src/lib/receipt.js';

const SITE = 'fixture.atlassian.net';
const ids = Object.fromEntries(Object.keys(PAGES).map((k, i) => [k, String(1000 + i)]));
const byId = Object.fromEntries(Object.entries(ids).map(([k, id]) => [id, k]));
const res = (status, body) => ({ status, headers: { get: () => null }, json: async () => body });

ISSUES.forEach((issue, index) => {
  const key = `${PROJECT.key}-${index + 1}`;
  test(`${key} "${issue.summary}" shows ${issue.expected}`, async () => {
    const http = {
      issue: async () => res(200, { key, fields: { summary: issue.summary } }),
      remoteLinks: async () =>
        res(
          200,
          issue.links.map((l) => ({
            globalId: `appId=decision-receipt-fixtures&pageId=${ids[l]}`,
            application: { type: 'com.atlassian.confluence', name: 'Confluence' },
            object: { url: `https://${SITE}/wiki/spaces/DRDEMO/pages/${ids[l]}`, title: PAGES[l].title },
          }))
        ),
      // A trashed page answers 404 to a normal read, as Confluence does.
      confluencePage: async (id) => {
        const p = PAGES[byId[id]];
        if (!p || p.trash) return res(404, {});
        return res(200, { id, title: p.title, status: 'current', version: { number: 1, createdAt: '2026-11-16T00:00:00Z' }, body: { storage: { value: p.body } } });
      },
      now: () => new Date('2026-11-16T12:00:00Z'),
      sleep: async () => {},
    };
    const { receipt } = await buildReceipt(key, SITE, http);
    assert.equal(receipt.overall, issue.expected);
    for (const [local, verdict] of Object.entries(issue.pageVerdicts)) {
      const p = receipt.pages.find((x) => x.pageId === ids[local]);
      assert.ok(p, `page ${local} missing from receipt`);
      assert.equal(p.verdict, verdict, `page ${local}`);
      // Every excerpt is an exact substring of the page text.
      for (const ex of p.excerpts) assert.ok(PAGES[local].body.replace(/&#39;/g, "'").includes(ex.text.replace(/\.\.\.$/, '')), ex.text);
    }
  });
});
