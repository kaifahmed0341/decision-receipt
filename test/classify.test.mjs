import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summaryTerms,
  mentionsKey,
  relevance,
  classifySentence,
  classifyPage,
  overallVerdict,
  prepareTask,
  taskObject,
  statusKind,
} from '../src/lib/classify.js';
import { stem, taskAction, directionOf } from '../src/lib/direction.js';
import { parseStorage } from '../src/lib/storage.js';

const task = (summary, key = 'X-1') => prepareTask({ key, summary });
const kind = (sentence, summary) => classifySentence(sentence, task(summary)).kind;

test('stems fold plurals and verb endings the same way on both sides', () => {
  for (const [a, b] of [['retire', 'retiring'], ['retire', 'retirement'], ['remove', 'removal'], ['raise', 'raising'], ['migrate', 'migration'], ['PDFs', 'pdf'], ['move', 'moved'], ['ship', 'shipped']]) {
    assert.equal(stem(a), stem(b), `${a} vs ${b}`);
  }
  assert.equal(stem('status'), 'status');
  assert.deepEqual(summaryTerms('Switch invoice PDFs to the new renderer'), ['switch', 'invoic', 'pdf', 'renderer']);
});

test('the task action comes from the first verb of the summary', () => {
  assert.equal(taskAction('Remove the v1 CSV export endpoint'), 'remove');
  assert.equal(taskAction('Keep the legacy REST API for existing partners'), 'keep');
  assert.equal(taskAction('Turn on single sign-on for the admin console'), 'enable');
  assert.equal(taskAction('Raise the upload size limit to 2 GB'), 'increase');
  assert.equal(taskAction('Quarterly planning notes'), null);
  assert.equal(directionOf('We agreed to keep the endpoint', 'remove'), 'opposite');
  assert.equal(directionOf('the endpoint will be removed', 'remove'), 'same');
  assert.deepEqual(taskObject('Move the status page to a managed provider', 'change'), ['status', 'pag']);
});

test('issue keys match as whole keys, including earlier keys of a moved issue', () => {
  assert.ok(mentionsKey('Approved for DREC-1 today.', ['DREC-1']));
  assert.ok(!mentionsKey('Approved for DREC-12 today.', ['DREC-1']));
  assert.ok(!mentionsKey('Approved for XDREC-1.', ['DREC-1']));
  assert.ok(mentionsKey('DREC-1 approved.', ['PLAT-44', 'DREC-1']));
});

test('relevance: key, 60 percent of the summary words, or the full object with a decision signal', () => {
  const t = task('Switch invoice PDFs to the new renderer', 'DREC-2');
  assert.equal(relevance('See DREC-2.', t.keys, t.terms).reason, 'key');
  assert.equal(relevance('The invoice renderer is slow.', t.keys, t.terms).relevant, false);
  assert.equal(relevance('We will switch invoice PDFs next week.', t.keys, t.terms).reason, 'terms');
  const s = task('Move the status page to a managed provider');
  assert.equal(relevance('We will keep hosting the status page ourselves.', s.keys, s.terms, s.object).reason, 'object');
});

test('direction: approving or keeping the opposite of the task is a conflict', () => {
  assert.equal(kind('We agreed to keep the v1 CSV export endpoint for another year.', 'Remove the v1 CSV export endpoint'), 'conflict');
  assert.equal(kind('We approved lowering the upload size limit to 250 MB.', 'Raise the upload size limit to 2 GB'), 'conflict');
  assert.equal(kind('The upload size limit stays at 500 MB.', 'Raise the upload size limit to 2 GB'), 'conflict');
  assert.equal(kind('Approved: retire the legacy REST API.', 'Keep the legacy REST API for existing partners'), 'conflict');
  assert.equal(kind('The legacy REST API remains available for existing partners.', 'Keep the legacy REST API for existing partners'), 'support');
});

test('the last decisive phrase wins, and rejecting the opposite supports the task', () => {
  assert.equal(kind('Retiring the importer was approved, then rolled back after the incident.', 'Retire the nightly batch importer'), 'conflict');
  assert.equal(kind('The proposal to keep the endpoint was rejected, so removal goes ahead.', 'Remove the v1 CSV export endpoint'), 'support');
  assert.equal(kind('The proposal to keep SMS reset was rejected, so it will be disabled in June.', 'Disable password reset by SMS'), 'support');
  assert.equal(kind('DREC-6 was approved, but legal reversed it on Friday.', 'Move audit logs'), 'conflict');
});

test('supersession, reversal and refusal phrases conflict', () => {
  for (const s of ['DEV-2 was superseded by the SSO project.', 'The migration was reverted after a week.', 'It was replaced by the event stream.', 'We decided not to enable passkeys.', 'We chose not to add it.', 'Never enable it without a fallback.']) {
    assert.equal(classifySentence(s, task('Enable passkeys')).kind, 'conflict', s);
  }
  assert.equal(kind('The change was not approved by the board.', 'Ship the thing'), 'conflict');
  assert.equal(kind('DREC-1 rejected, keep the endpoint.', 'Remove the v1 CSV export endpoint'), 'conflict');
  assert.equal(kind('Never disable it without a fallback.', 'Enable passkeys'), 'support');
});

test('partial approvals conflict, hedged and conditional ones are mentions', () => {
  assert.equal(kind('Passkeys are approved for staff accounts only; customer login waits.', 'Enable passkeys for customer login'), 'conflict');
  assert.equal(kind('Switching is approved for the EU team as a first phase.', 'Switch the support inbox to the new ticketing tool'), 'conflict');
  assert.equal(kind('X-1 is approved in principle, pending sign-off.', 'Retire the importer'), 'mention');
  assert.equal(kind('We confirmed X-1 can ship once the load tests pass.', 'Ship it'), 'mention');
  assert.equal(kind('Raising the limit was discussed, but nothing was agreed.', 'Raise the limit'), 'mention');
  assert.equal(kind('We don\'t think SMS reset should be disabled yet.', 'Disable password reset by SMS'), 'mention');
  assert.equal(kind('Should this be approved?', 'Ship it'), 'mention');
});

test('plans with a date and labelled decisions count as support', () => {
  assert.equal(kind('The nightly batch importer will be retired on 15 April.', 'Retire the nightly batch importer'), 'support');
  assert.equal(kind('Invoice PDFs switch to the new renderer in release 4.2.', 'Switch invoice PDFs to the new renderer'), 'support');
  assert.equal(kind('Decision: go. Raise the limit to 600 from Monday.', 'Raise the limit to 600'), 'support');
  assert.equal(kind('Enable passkeys for customer login: yes.', 'Enable passkeys for customer login'), 'support');
});

test('status values read as support, conflict or open, also with a qualifier', () => {
  assert.equal(statusKind('DECIDED'), 'support');
  assert.equal(statusKind('Superseded by the March review'), 'conflict');
  assert.equal(statusKind('In progress'), 'open');
  assert.equal(statusKind('Approve later'), null);
});

test('a status line counts only for its own section', () => {
  const units = parseStorage('<h2>DREC-1 remove CSV export</h2><p>Status: Approved</p><h2>DREC-9 billing rewrite</h2><p>Status: Rejected</p>', 'Council notes');
  const r = classifyPage(units, { key: 'DREC-1', summary: 'Remove the v1 CSV export endpoint' });
  assert.equal(r.verdict, 'supports');
  assert.deepEqual(r.findings.map((f) => f.sentence), ['Status: Approved']);
  const other = classifyPage(parseStorage('<h2>DREC-9 billing rewrite</h2><p>Status: Approved</p>'), { key: 'DREC-1', summary: 'Remove the v1 CSV export endpoint' });
  assert.equal(other.verdict, 'missing');
  const shared = classifyPage(parseStorage('<p>DREC-1 and DREC-9 were reviewed.</p><p>Status: Approved</p>'), { key: 'DREC-1', summary: 'x' });
  assert.equal(shared.findings[0].kind, 'mention');
});

test('page verdicts: conflict beats support, mentions alone are missing', () => {
  const issue = { key: 'DREC-9', summary: 'Ship the thing' };
  const page = (html) => classifyPage(parseStorage(html), issue).verdict;
  assert.equal(page('<p>DREC-9 approved. DREC-9 deferred.</p>'), 'conflicts');
  assert.equal(page('<p>DREC-9 approved.</p>'), 'supports');
  assert.equal(page('<p>We discussed DREC-9.</p>'), 'missing');
  assert.equal(page('<p>Unrelated text.</p>'), 'missing');
});

test('overall verdict never claims approval and treats unread links as gaps', () => {
  const ok = (verdict) => ({ status: 'ok', verdict });
  assert.equal(overallVerdict([]), 'no-links');
  assert.equal(overallVerdict([ok('supports')]), 'all-support');
  assert.equal(overallVerdict([ok('supports')], { unreadable: 1 }), 'incomplete');
  assert.equal(overallVerdict([ok('supports')], { otherSite: 1 }), 'incomplete');
  assert.equal(overallVerdict([ok('supports')], { skipped: 2 }), 'incomplete');
  assert.equal(overallVerdict([], { unreadable: 1 }), 'unchecked');
  assert.equal(overallVerdict([ok('supports'), ok('conflicts')]), 'conflict');
  assert.equal(overallVerdict([ok('supports'), ok('missing')]), 'incomplete');
  assert.equal(overallVerdict([ok('missing'), { status: 'unavailable' }]), 'missing');
  assert.equal(overallVerdict([{ status: 'unavailable' }]), 'unchecked');
});
