// Parser tests on storage format that Confluence itself produced on the test site
// (test/storage-samples), plus the review's probe cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseStorage } from '../src/lib/storage.js';
import { classifyPage } from '../src/lib/classify.js';

const sample = (name) => readFileSync(new URL(`./storage-samples/${name}`, import.meta.url), 'utf8');
const DREC1 = { key: 'DREC-1', summary: 'Remove the v1 CSV export endpoint' };
const verdict = (html, title, issue = DREC1) => classifyPage(parseStorage(html, title), issue);

test('real page: status lozenge, decision item, tasks and table rows are read as fields', () => {
  const units = parseStorage(sample('adf-mixed.xml'), 'Sample');
  const by = (k) => units.filter((u) => u.kind === k);
  assert.deepEqual(by('decision').map((u) => [u.text, u.decisionState]), [['DREC-1 rejected, keep the endpoint', 'DECIDED']]);
  assert.deepEqual(by('task').map((u) => [u.text, u.taskState]), [['DREC-1 approved by the API council', 'complete'], ['Approve DREC-2', 'incomplete']]);
  assert.ok(by('row').some((u) => u.text === 'DREC-1 | Remove the v1 CSV export endpoint | Approved'));
  assert.ok(units.some((u) => u.text === 'Status: DECIDED' && u.statuses[0] === 'DECIDED'));
  const all = units.map((u) => u.text).join(' / ');
  assert.ok(!all.includes('placeholder'), 'editor placeholder dropped');
  assert.ok(!/DREC-1 approved\.(?! by)/.test(all), 'struck-out text dropped');
  assert.equal((all.match(/keep the endpoint/g) || []).length, 1, 'decision fallback copy dropped');
  assert.ok(!all.includes('Details'), 'macro parameter dropped');
  assert.ok(all.includes('Inside an expand.'), 'expand body kept');
});

test('the review probes no longer read as "Decision not found"', () => {
  assert.equal(verdict('<ac:task-list><ac:task><ac:task-id>1</ac:task-id><ac:task-status>complete</ac:task-status><ac:task-body>DREC-1 approved by the API council</ac:task-body></ac:task></ac:task-list>').verdict, 'supports');
  assert.equal(verdict('<table><tbody><tr><th>Status</th><td><ac:structured-macro ac:name="status"><ac:parameter ac:name="title">DECIDED</ac:parameter><ac:parameter ac:name="colour">Green</ac:parameter></ac:structured-macro></td></tr><tr><th>Decision</th><td>Remove the v1 CSV export endpoint</td></tr></tbody></table>').verdict, 'supports');
  assert.equal(verdict('<table><tbody><tr><th>Issue</th><th>Decision</th><th>Outcome</th></tr><tr><td>DREC-1</td><td>Remove the v1 CSV export endpoint</td><td>Approved</td></tr></tbody></table>').verdict, 'supports');
  assert.equal(verdict(sample('adf-mixed.xml'), 'Sample').verdict, 'conflicts', 'the decided item keeps the endpoint');
});

test('hidden, placeholder and struck-out text cannot turn a page green', () => {
  assert.equal(verdict('<p>Notes from the API council.</p><p><ac:placeholder>DREC-1 approved.</ac:placeholder></p>').verdict, 'missing');
  assert.equal(verdict('<ac:structured-macro ac:name="excerpt"><ac:parameter ac:name="hidden">true</ac:parameter><ac:rich-text-body><p>DREC-1 approved.</p></ac:rich-text-body></ac:structured-macro><p>Notes.</p>').verdict, 'missing');
  assert.equal(verdict('<p><span style="text-decoration: line-through;">DREC-1 approved.</span> DREC-1 is on hold until Q3.</p>').verdict, 'conflicts');
  assert.equal(verdict('<p><del>DREC-1 approved.</del></p>').verdict, 'missing');
  assert.equal(verdict('<p><s>DREC-1 approved.</s></p>').verdict, 'missing');
});

test('an open task and an undecided item do not count as support', () => {
  assert.equal(verdict('<ac:task-list><ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>DREC-1 approved by the API council</ac:task-body></ac:task></ac:task-list>').verdict, 'missing');
  assert.equal(verdict('<ac:task-list><ac:task><ac:task-status>complete</ac:task-status><ac:task-body>Approve DREC-1</ac:task-body></ac:task></ac:task-list>').verdict, 'supports');
});

test('a Jira issue macro counts as naming the key', () => {
  assert.equal(verdict('<p><ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">DREC-1</ac:parameter></ac:structured-macro> approved by the council.</p>').verdict, 'supports');
});

test('unfilled Confluence templates decide nothing', () => {
  const issue = { key: 'DREC-1', summary: 'Remove the v1 CSV export endpoint' };
  for (const f of ['template-daci-decision-documentation.xml', 'template-designentscheidung.xml', 'template-decision-log.xml']) {
    const r = verdict(sample(f), 'Decision: remove the v1 CSV export endpoint', issue);
    assert.notEqual(r.verdict, 'supports', f);
    assert.notEqual(r.verdict, 'conflicts', f);
  }
});

test('a filled DACI page reads its status lozenge, scoped by the page title', () => {
  const filled = sample('template-daci-decision-documentation.xml').replace(
    /<p><ac:structured-macro ac:name="status"[^]*?Complete<\/ac:parameter><ac:parameter ac:name="colour">Green<\/ac:parameter><\/ac:structured-macro><\/p>/,
    '<p><ac:structured-macro ac:name="status"><ac:parameter ac:name="title">DECIDED</ac:parameter></ac:structured-macro></p>'
  );
  assert.notEqual(filled, sample('template-daci-decision-documentation.xml'));
  assert.equal(verdict(filled, 'Decision: remove the v1 CSV export endpoint').verdict, 'supports');
  assert.equal(verdict(filled, 'Decision: keep the v1 CSV export endpoint').verdict, 'conflicts');
  assert.equal(verdict(filled, 'Decision: billing rewrite').verdict, 'missing');
});

test('sentences inside one paragraph are still judged one by one', () => {
  const r = verdict('<p>Context first. DREC-1 is deferred. The rest is unrelated.</p>');
  assert.deepEqual(r.findings.map((f) => f.sentence), ['DREC-1 is deferred.']);
});
