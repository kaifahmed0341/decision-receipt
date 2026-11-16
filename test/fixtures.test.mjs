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

/** A fake site serving the fixture pages, as the owner or as a user without restricted access. */
function fakeSite(issue, key, { owner = true, edited = false } = {}) {
  return {
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
        if (!p || p.trash || (p.restrictToOwner && !owner)) return res(404, {});
        const body = edited && p.editedBody ? p.editedBody : p.body;
        const version = edited && p.editedBody ? 2 : 1;
        return res(200, { id, title: p.title, status: 'current', version: { number: version, createdAt: '2026-11-16T00:00:00Z' }, body: { storage: { value: body } } });
      },
      now: () => new Date('2026-11-16T12:00:00Z'),
      sleep: async () => {},
  };
}

ISSUES.forEach((issue, index) => {
  const key = `${PROJECT.key}-${index + 1}`;
  test(`${key} "${issue.summary}" shows ${issue.expected}`, async () => {
    const http = fakeSite(issue, key);
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

  if (issue.expectedForOthers) {
    test(`${key} as a user without access to the restricted page shows ${issue.expectedForOthers} and nothing from it`, async () => {
      const { receipt } = await buildReceipt(key, SITE, fakeSite(issue, key, { owner: false }));
      assert.equal(receipt.overall, issue.expectedForOthers);
      const json = JSON.stringify(receipt);
      for (const local of issue.links.filter((l) => PAGES[l].restrictToOwner)) {
        assert.ok(!json.includes(PAGES[local].title), 'restricted title leaked');
        assert.ok(!json.includes(ids[local]), 'restricted page id leaked');
        assert.ok(!json.includes('Legal'), 'restricted text leaked');
      }
    });
  }

  if (issue.expectedAfterEdit) {
    test(`${key} after the scripted edit shows ${issue.expectedAfterEdit}`, async () => {
      const { receipt } = await buildReceipt(key, SITE, fakeSite(issue, key, { edited: true }));
      assert.equal(receipt.overall, issue.expectedAfterEdit);
    });
  }
});
