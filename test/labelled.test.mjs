import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../fixtures/labelled-excerpts.json', import.meta.url), 'utf8'));

test('the labelled set has at least 20 excerpts with known labels and issues', () => {
  assert.ok(data.excerpts.length >= 20);
  for (const e of data.excerpts) {
    assert.ok(['support', 'conflict', 'mention', 'irrelevant'].includes(e.expected), e.text);
    assert.ok(data.issues[e.issue], e.issue);
    assert.ok(e.text.length > 0);
  }
});
