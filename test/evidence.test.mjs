import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatUtc,
  explainFinding,
  excerptOf,
  okPageEvidence,
  problemPageEvidence,
  linkNotes,
  OVERALL,
  PAGE_VERDICTS,
  MAX_EXCERPT_CHARS,
  MAX_EXCERPTS_PER_PAGE,
} from '../src/lib/evidence.js';

test('times are shown in UTC with seconds', () => {
  assert.equal(formatUtc('2026-11-16T09:05:03.120Z'), '16 Nov 2026, 09:05:03 UTC');
  assert.equal(formatUtc('nonsense'), 'unknown time');
  assert.equal(formatUtc(undefined), 'unknown time');
});

test('each finding explains why it was picked', () => {
  assert.equal(explainFinding({ reason: 'key', cue: 'agreed', matchedTerms: [] }, 'DREC-2'), 'Names DREC-2. Phrase: "agreed".');
  assert.equal(explainFinding({ reason: 'status', cue: null, matchedTerms: [] }, 'X-1'), 'Page status line. No decision phrase.');
  assert.equal(
    explainFinding({ reason: 'terms', cue: 'question', matchedTerms: ['invoice', 'pdf'] }, 'X-1'),
    'Uses the summary words invoice, pdf. Asked as a question, so not a decision.'
  );
});

test('excerpts keep the exact words and mark a cut', () => {
  assert.deepEqual(excerptOf('Short sentence.'), { text: 'Short sentence.', truncated: false });
  const long = 'word '.repeat(200).trim();
  const cut = excerptOf(long);
  assert.equal(cut.truncated, true);
  assert.ok(long.startsWith(cut.text.replace(/\.\.\.$/, '')));
  assert.ok(cut.text.length <= MAX_EXCERPT_CHARS + 3);
});

test('a readable page carries version, edit time, retrieval time and sorted excerpts', () => {
  const findings = [
    { sentence: 'Mention DREC-1.', kind: 'mention', cue: null, reason: 'key', matchedTerms: [] },
    { sentence: 'DREC-1 approved.', kind: 'support', cue: 'approved', reason: 'key', matchedTerms: [] },
    { sentence: 'DREC-1 deferred.', kind: 'conflict', cue: 'deferred', reason: 'key', matchedTerms: [] },
  ];
  const e = okPageEvidence({
    issue: { key: 'DREC-1' },
    link: { pageId: '42', url: 'https://x/wiki/spaces/D/pages/42' },
    page: { title: 'Decision page', version: 3, editedAt: '2026-11-01T10:00:00Z' },
    retrievedAt: '2026-11-16T11:00:00Z',
    result: { verdict: 'conflicts', findings },
  });
  assert.equal(e.status, 'ok');
  assert.equal(e.provenance, 'Version 3, last edited 1 Nov 2026, 10:00:00 UTC. Retrieved 16 Nov 2026, 11:00:00 UTC.');
  assert.deepEqual(e.excerpts.map((x) => x.kind), ['conflict', 'support', 'mention']);
  assert.equal(e.verdictLabel, PAGE_VERDICTS.conflicts.label);
  assert.equal(e.emptyNote, null);
});

test('no more than the excerpt limit is shown, and the rest are counted', () => {
  const findings = Array.from({ length: MAX_EXCERPTS_PER_PAGE + 2 }, (_, i) => ({ sentence: `DREC-1 line ${i}.`, kind: 'mention', cue: null, reason: 'key', matchedTerms: [] }));
  const e = okPageEvidence({ issue: { key: 'DREC-1' }, link: { pageId: '1', url: 'u' }, page: { title: 't', version: 1, editedAt: '' }, retrievedAt: '', result: { verdict: 'missing', findings } });
  assert.equal(e.excerpts.length, MAX_EXCERPTS_PER_PAGE);
  assert.equal(e.hiddenExcerpts, 2);
});

test('a page with no relevant sentence says so', () => {
  const e = okPageEvidence({ issue: { key: 'DREC-3' }, link: { pageId: '1', url: 'u' }, page: { title: 't', version: 1, editedAt: '' }, retrievedAt: '', result: { verdict: 'missing', findings: [] } });
  assert.match(e.emptyNote, /No sentence on this page names DREC-3/);
});

test('a page that could not be read carries no title, url or page id', () => {
  for (const status of ['unavailable', 'not-current', 'rate-limited', 'interrupted', 'timed-out', 'error']) {
    const e = problemPageEvidence(status, '2026-11-16T11:00:00Z');
    assert.equal(e.status, status);
    assert.equal(e.title, undefined);
    assert.equal(e.url, undefined);
    assert.equal(e.pageId, undefined);
    assert.deepEqual(e.excerpts, []);
  }
});

test('no wording anywhere claims approval', () => {
  const words = JSON.stringify(OVERALL) + JSON.stringify(PAGE_VERDICTS);
  assert.ok(!/\bapproved\b/i.test(words));
  assert.match(OVERALL['all-support'].detail, /does not approve/);
});

test('link notes count what was skipped', () => {
  assert.deepEqual(linkNotes({ otherSite: 0, unreadable: 0, skipped: 0 }), []);
  assert.equal(linkNotes({ otherSite: 2, unreadable: 1, skipped: 0 }).length, 2);
  assert.match(linkNotes({ otherSite: 1, unreadable: 0, skipped: 0 })[0], /^1 link points to another site and was not checked/);
});
