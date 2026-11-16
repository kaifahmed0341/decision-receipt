import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summaryTerms,
  mentionsKey,
  relevance,
  classifySentence,
  classifyPage,
  overallVerdict,
  normaliseWord,
} from '../src/lib/classify.js';

test('summary terms drop stopwords, short words and numbers, and fold plurals', () => {
  assert.deepEqual(summaryTerms('Switch invoice PDFs to the new renderer'), ['switch', 'invoice', 'pdf', 'renderer']);
  assert.deepEqual(summaryTerms('Raise the limit to 600'), ['raise', 'limit']);
  assert.equal(normaliseWord('Process'), 'process');
  assert.deepEqual(summaryTerms('This status uses APIs'), ['statu', 'use', 'api']);
});

test('issue keys match as whole keys only', () => {
  assert.ok(mentionsKey('Approved for DREC-1 today.', 'DREC-1'));
  assert.ok(mentionsKey('(drec-1)', 'DREC-1'));
  assert.ok(!mentionsKey('Approved for DREC-12 today.', 'DREC-1'));
  assert.ok(!mentionsKey('Approved for XDREC-1.', 'DREC-1'));
});

test('relevance needs the key, a status line, or 60 percent of summary words', () => {
  const terms = summaryTerms('Switch invoice PDFs to the new renderer');
  assert.equal(relevance('Status: Deferred', 'DREC-2', terms).reason, 'status');
  assert.equal(relevance('See DREC-2.', 'DREC-2', terms).reason, 'key');
  assert.equal(relevance('The invoice renderer is slow.', 'DREC-2', terms).relevant, false);
  const r = relevance('We will switch invoice PDFs next week.', 'DREC-2', terms);
  assert.equal(r.relevant, true);
  assert.deepEqual(r.matchedTerms, ['switch', 'invoice', 'pdf']);
});

test('blocking phrases win over supporting phrases in one sentence', () => {
  assert.equal(classifySentence('This was approved but is now deferred.').kind, 'conflict');
  assert.equal(classifySentence('We will not ship it.').kind, 'conflict');
  assert.equal(classifySentence('The plan is rejected.').kind, 'conflict');
});

test('a negation just before a supporting phrase makes it a conflict', () => {
  const r = classifySentence('The change was not approved by the board.');
  assert.equal(r.kind, 'conflict');
  assert.equal(classifySentence('It has never been agreed.').kind, 'conflict');
  assert.equal(classifySentence('No, this is not something we confirmed yesterday or ever.').kind, 'conflict');
});

test('supporting phrases count as support', () => {
  assert.deepEqual(classifySentence('The team agreed to move ahead.'), { kind: 'support', cue: 'agreed' });
  assert.equal(classifySentence('Status: Decided').kind, 'support');
  assert.equal(classifySentence('Decision: go').kind, 'support');
});

test('questions and plain mentions are not decisions', () => {
  assert.deepEqual(classifySentence('Should this be approved?'), { kind: 'mention', cue: 'question' });
  assert.deepEqual(classifySentence('We talked about it.'), { kind: 'mention', cue: null });
});

test('page verdicts: conflict beats support, mentions alone are missing', () => {
  const issue = { key: 'DREC-9', summary: 'Ship the thing' };
  assert.equal(classifyPage(['DREC-9 approved.', 'DREC-9 deferred.'], issue).verdict, 'conflicts');
  assert.equal(classifyPage(['DREC-9 approved.'], issue).verdict, 'supports');
  assert.equal(classifyPage(['We discussed DREC-9.'], issue).verdict, 'missing');
  assert.equal(classifyPage(['Unrelated text.'], issue).verdict, 'missing');
  assert.equal(classifyPage(['Unrelated text.'], issue).findings.length, 0);
});

test('overall verdict never claims approval and treats unread pages as gaps', () => {
  const ok = (verdict) => ({ status: 'ok', verdict });
  assert.equal(overallVerdict([]), 'no-links');
  assert.equal(overallVerdict([ok('supports')]), 'all-support');
  assert.equal(overallVerdict([ok('supports'), ok('conflicts')]), 'conflict');
  assert.equal(overallVerdict([ok('supports'), ok('missing')]), 'incomplete');
  assert.equal(overallVerdict([ok('supports'), { status: 'unavailable' }]), 'incomplete');
  assert.equal(overallVerdict([ok('missing'), { status: 'unavailable' }]), 'missing');
  assert.equal(overallVerdict([{ status: 'unavailable' }]), 'unchecked');
  assert.equal(overallVerdict([{ status: 'rate-limited' }, ok('conflicts')]), 'conflict');
});
