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
const kind = (sentence, summary) => classifySentence(sentence, task(summary, (sentence.match(/\b[A-Z]+-\d+\b/) || ['X-1'])[0])).kind;

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

test('direction: approving the opposite of the task is a conflict', () => {
  assert.equal(kind('We agreed to keep the v1 CSV export endpoint for another year.', 'Remove the v1 CSV export endpoint'), 'conflict');
  assert.equal(kind('We approved lowering the upload size limit to 250 MB.', 'Raise the upload size limit to 2 GB'), 'conflict');
  assert.equal(kind('Approved: retire the legacy REST API.', 'Keep the legacy REST API for existing partners'), 'conflict');
});

test('statements without a decision phrase are left unclear, never decided', () => {
  assert.equal(kind('The upload size limit stays at 500 MB.', 'Raise the upload size limit to 2 GB'), 'mention');
  assert.equal(kind('The legacy REST API remains available for existing partners.', 'Keep the legacy REST API for existing partners'), 'mention');
  assert.equal(kind('The nightly batch importer will be retired on 15 April.', 'Retire the nightly batch importer'), 'mention');
  assert.equal(kind('Invoice PDFs switch to the new renderer in release 4.2.', 'Switch invoice PDFs to the new renderer'), 'mention');
  // Review 2, H1: a date never decides anything on its own.
  assert.equal(kind('DREC-1 came up in the architecture review in May; nobody took it.', 'Remove the v1 CSV export endpoint'), 'mention');
  assert.equal(kind('We talked about DREC-4 in Q3 planning.', 'Archive the legacy webhook queue'), 'mention');
});

test('the last decisive phrase wins; a reversal takes its subject from the sentence', () => {
  assert.equal(kind('Retiring the importer was approved, then rolled back after the incident.', 'Retire the nightly batch importer'), 'conflict');
  assert.equal(kind('X-1 was approved in May, but the ops review rolled the change back.', 'Ship it'), 'conflict');
  assert.equal(kind('The proposal to keep the endpoint was rejected, so removal goes ahead.', 'Remove the v1 CSV export endpoint'), 'support');
  assert.equal(kind('DREC-6 was approved, but legal reversed it on Friday.', 'Move audit logs'), 'conflict');
  // Refusing the opposite is not treated as a decision for the task: unclear.
  assert.equal(kind('The proposal to keep SMS reset was rejected, so it will be disabled in June.', 'Disable password reset by SMS'), 'mention');
});

test('supersession, reversal and refusal phrases conflict when they name the task', () => {
  for (const s of ['X-1 was superseded by the SSO project.', 'X-1 was reverted after a week.', 'X-1 was replaced by the event stream.', 'We decided not to enable passkeys.', 'We chose not to enable it.', 'Never enable it without a fallback.', 'X-1 is parked until next year.', 'We cannot do X-1 now.']) {
    assert.equal(kind(s, 'Enable passkeys'), 'conflict', s);
  }
  assert.equal(kind('The change was not approved by the board.', 'Ship the change'), 'mention', 'no key and no action named');
  assert.equal(kind('X-1 was not approved by the board.', 'Ship the change'), 'conflict');
  assert.equal(kind('DREC-1 rejected, keep the endpoint.', 'Remove the v1 CSV export endpoint'), 'conflict');
});

test('double negatives are unclear, not conflicts', () => {
  assert.equal(kind('The June rollback of the move was itself reversed; backups run on object storage again.', 'Move nightly backups to object storage'), 'mention');
  assert.equal(kind('We rejected REST-only for the partner API and will adopt GraphQL.', 'Adopt GraphQL for the partner API'), 'mention');
});

test('a decision phrase that does not say for what is unclear', () => {
  assert.equal(kind('The security group signed off on it.', 'Enable passkeys for customer login'), 'mention');
  assert.equal(kind('The migration was reverted after a week.', 'Enable passkeys'), 'mention');
});

test('partial approvals conflict, hedged, conditional and different amounts are unclear', () => {
  assert.equal(kind('X-1 is approved for staff accounts only; customer login waits.', 'Enable passkeys for customer login'), 'conflict');
  assert.equal(kind('Switching is approved for the EU team as a first phase.', 'Switch the support inbox to the new ticketing tool'), 'conflict');
  assert.equal(kind('X-1 is approved with exception: security logs keep 1 year.', 'Reduce log retention to 30 days'), 'conflict');
  assert.equal(kind('X-1 is approved in principle, pending sign-off.', 'Retire the importer'), 'mention');
  assert.equal(kind('We confirmed X-1 can ship once the load tests pass.', 'Ship it'), 'mention');
  assert.equal(kind('We agreed to raise the upload limit to 1 GB, not 2 GB.', 'Raise the upload limit to 2 GB'), 'mention');
  assert.equal(kind('Raising the limit was discussed, but nothing was agreed.', 'Raise the limit'), 'mention');
  assert.equal(kind('We don\'t think SMS reset should be disabled yet.', 'Disable password reset by SMS'), 'mention');
  assert.equal(kind('Should this be approved?', 'Ship it'), 'mention');
});

test('explicit decisions that name the task or its action count', () => {
  assert.equal(kind('Decision: go. Raise the limit to 600 from Monday.', 'Raise the limit to 600'), 'support');
  assert.equal(kind('Enable passkeys for customer login: yes.', 'Enable passkeys for customer login'), 'support');
  assert.equal(kind('The board approved raising the upload size limit to 2 GB.', 'Raise the upload size limit to 2 GB'), 'support');
  assert.equal(kind('DREC-1 approved by the council.', 'Anything'), 'support');
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

test('page verdicts: conflict beats support, mentions alone are unclear, nothing is missing', () => {
  const issue = { key: 'DREC-9', summary: 'Ship the thing' };
  const page = (html) => classifyPage(parseStorage(html), issue).verdict;
  assert.equal(page('<p>DREC-9 approved. DREC-9 deferred.</p>'), 'conflicts');
  assert.equal(page('<p>DREC-9 approved.</p>'), 'supports');
  assert.equal(page('<p>We discussed DREC-9.</p>'), 'unclear');
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
  assert.equal(overallVerdict([ok('unclear'), ok('missing')]), 'unclear');
  assert.equal(overallVerdict([ok('supports'), ok('unclear')]), 'unclear');
  assert.equal(overallVerdict([{ status: 'unavailable' }]), 'unchecked');
});
