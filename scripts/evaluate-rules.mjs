#!/usr/bin/env node
/**
 * Scores the rule set against hand-labelled excerpts and prints every hit and miss.
 *
 * Each excerpt is classified exactly as one sentence of a page would be: first the
 * relevance rule (issue key, status line or summary words), then the phrase rules.
 * A sentence that is not relevant is labelled "irrelevant".
 *
 * Usage: node scripts/evaluate-rules.mjs [path/to/labelled-excerpts.json] [--json]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { summaryTerms, relevance, classifySentence } from '../src/lib/classify.js';

// Default: the development set (both files). Pass one or more JSON files to score others.
const given = process.argv.filter((a) => a.endsWith('.json'));
const files = given.length
  ? given
  : ['../fixtures/labelled-excerpts.json', '../fixtures/dev-excerpts.json'].map((f) => fileURLToPath(new URL(f, import.meta.url)));
const data = { issues: {}, excerpts: [] };
for (const f of files) {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  Object.assign(data.issues, d.issues);
  data.excerpts.push(...d.excerpts);
}
const LABELS = ['support', 'conflict', 'mention', 'irrelevant'];

export function predict(text, issueKey, summary) {
  const rel = relevance(text, issueKey, summaryTerms(summary));
  if (!rel.relevant) return 'irrelevant';
  return classifySentence(text).kind;
}

const rows = data.excerpts.map((e) => {
  const got = predict(e.text, e.issue, data.issues[e.issue]);
  return { ...e, got, hit: got === e.expected };
});

const confusion = Object.fromEntries(LABELS.map((a) => [a, Object.fromEntries(LABELS.map((b) => [b, 0]))]));
for (const r of rows) confusion[r.expected][r.got] += 1;
const perLabel = Object.fromEntries(
  LABELS.map((l) => {
    const tp = confusion[l][l];
    const predicted = LABELS.reduce((n, e) => n + confusion[e][l], 0);
    const actual = LABELS.reduce((n, g) => n + confusion[l][g], 0);
    const round = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
    return [l, { expected: actual, predicted, correct: tp, precision: round(tp / predicted), recall: round(tp / actual) }];
  })
);
// The costly mistake for this app: a sentence a human reads as a conflict that the rules call support.
const conflictShownAsSupport = rows.filter((r) => r.expected === 'conflict' && r.got === 'support').length;
const supportShownAsConflict = rows.filter((r) => r.expected === 'support' && r.got === 'conflict').length;
const hits = rows.filter((r) => r.hit).length;
const summary = { total: rows.length, hits, misses: rows.length - hits, accuracy: +(hits / rows.length).toFixed(3), perLabel, conflictShownAsSupport, supportShownAsConflict, confusion };

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
} else {
  for (const r of rows) console.log(`${r.hit ? 'HIT ' : 'MISS'}  ${r.issue}  expected ${r.expected.padEnd(10)} got ${r.got.padEnd(10)}  ${r.text}`);
  console.log('');
  console.log(`${hits} of ${rows.length} correct (${(100 * summary.accuracy).toFixed(1)} percent).`);
  for (const l of LABELS) {
    const p = perLabel[l];
    console.log(`  ${l.padEnd(10)} labelled ${p.expected}, predicted ${p.predicted}, correct ${p.correct}, precision ${p.precision ?? 'n/a'}, recall ${p.recall ?? 'n/a'}`);
  }
  console.log(`  conflicts the rules called support: ${conflictShownAsSupport}`);
  console.log(`  supports the rules called conflict: ${supportShownAsConflict}`);
  console.log('');
  console.log('Confusion (rows = human label, columns = rule output):');
  console.log(`  ${''.padEnd(10)} ${LABELS.map((l) => l.padEnd(10)).join(' ')}`);
  for (const a of LABELS) console.log(`  ${a.padEnd(10)} ${LABELS.map((b) => String(confusion[a][b]).padEnd(10)).join(' ')}`);
}
