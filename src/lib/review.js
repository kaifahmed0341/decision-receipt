/**
 * Loads a check with its recorded state, and records a fresh check.
 *
 * `store` is Forge key-value storage in production and a Map in the tests. Records
 * are keyed by site, issue and user (see staleness.js), and hold page ids, versions
 * and verdicts only.
 */
import { createHash } from 'crypto';
import { buildReceipt, ReceiptError } from './receipt.js';
import { recordKey, compareWithRecord, makeRecord, fingerprintString, summaryHash } from './staleness.js';
import { formatUtc, OVERALL } from './evidence.js';
import { RULES_VERSION } from './classify.js';

/**
 * A short hash of the fingerprint. The panel sends it back when the reviewer records a
 * check, so the server can refuse if the pages changed while the reviewer was reading.
 * Page ids in the fingerprint are the same ids Jira already shows the viewer in the link.
 */
export function fingerprintHash(fingerprint, summary = '', unread = {}) {
  const extra = `|${summaryHash(summary)}|${RULES_VERSION}|${unread.otherSite || 0},${unread.unreadable || 0},${unread.skipped || 0}`;
  return createHash('sha256').update(fingerprintString(fingerprint) + extra).digest('hex').slice(0, 32);
}

/** What the current check is compared on, besides the pages. */
function contextOf(built) {
  return { summaryHash: summaryHash(built.summary), rulesVersion: RULES_VERSION, unread: built.unread };
}

/** The storage key for this reviewer; refuses when the platform gave no account id. */
function keyFor(ctx) {
  if (!ctx.accountId) throw new ReceiptError('no-account', 'Recorded checks need a signed-in Atlassian account.');
  return recordKey(ctx.cloudId, ctx.issueId, ctx.accountId);
}

/** Page id to title, for pages the viewer can read in this check. */
function readableTitles(receipt) {
  const titles = {};
  for (const p of receipt.pages) if (p.status === 'ok') titles[String(p.pageId)] = p.title;
  return titles;
}

/** Words for the record banner. Only the change texts go to the panel, never page ids. */
function describeRecord(full) {
  const cmp = { state: full.state, recordedAt: full.recordedAt, changes: full.changes.map((c) => c.text) };
  const recorded = full.recordedOverall && OVERALL[full.recordedOverall] ? OVERALL[full.recordedOverall].label : null;
  if (cmp.state === 'none') {
    return {
      ...cmp,
      label: 'Not recorded',
      appearance: 'default',
      detail: 'You have not recorded a check of this issue. Read the excerpts, then select Record this check.',
    };
  }
  const when = formatUtc(cmp.recordedAt);
  // A current record is shown in a neutral colour: recording a check is not a sign-off.
  if (cmp.state === 'current') {
    return {
      ...cmp,
      label: 'Recorded check still matches',
      appearance: 'default',
      detail: `You recorded "${recorded || 'a result'}" at ${when}. Nothing it depends on has changed since.`,
    };
  }
  return {
    ...cmp,
    label: 'Recorded check is stale',
    appearance: 'removed',
    detail: `You recorded "${recorded || 'a result'}" at ${when}. That no longer holds. Read the evidence below, then record a fresh check.`,
  };
}

/**
 * Runs a live check and compares it with this user's record.
 * @param {{issueKey: string, siteHost: string|null, cloudId: string, issueId: string, accountId: string}} ctx
 * @param {object} http see receipt.js
 * @param {{get: (k: string) => Promise<any>, set: (k: string, v: any) => Promise<void>}} store
 */
export async function loadReview(ctx, http, store) {
  const built = await buildReceipt(ctx.issueKey, ctx.siteHost, http);
  const { receipt, fingerprint } = built;
  const record = ctx.accountId ? await store.get(keyFor(ctx)) : undefined;
  const cmp = compareWithRecord(record, fingerprint, readableTitles(receipt), contextOf(built));
  return {
    receipt,
    record: describeRecord(cmp),
    canRecord: Boolean(ctx.accountId),
    fingerprintHash: fingerprintHash(fingerprint, built.summary, built.unread),
  };
}

/**
 * Records a fresh check. The pages are read again now; if they differ from what the
 * reviewer was looking at, nothing is stored and the panel is asked to check again.
 * @param {object} ctx as for loadReview
 * @param {object} http
 * @param {object} store
 * @param {string} seenHash the fingerprintHash the reviewer's panel showed
 */
export async function recordReview(ctx, http, store, seenHash) {
  const key = keyFor(ctx);
  const built = await buildReceipt(ctx.issueKey, ctx.siteHost, http);
  const { receipt, fingerprint } = built;
  const context = contextOf(built);
  const hash = fingerprintHash(fingerprint, built.summary, built.unread);
  if (hash !== seenHash) {
    return {
      recorded: false,
      message: 'The linked pages changed while you were reading, so nothing was recorded. Read the new evidence, then record again.',
      receipt,
      record: describeRecord(compareWithRecord(await store.get(key), fingerprint, readableTitles(receipt), context)),
      fingerprintHash: hash,
    };
  }
  if (fingerprint.some((p) => p.status !== 'ok' && p.status !== 'unavailable' && p.status !== 'not-current')) {
    return {
      recorded: false,
      message: 'Some pages were not read because of a rate limit, an interrupted request or the time limit. Check again before recording.',
      receipt,
      record: describeRecord(compareWithRecord(await store.get(key), fingerprint, readableTitles(receipt), context)),
      fingerprintHash: hash,
    };
  }
  const record = makeRecord(receipt, fingerprint, context);
  await store.set(key, record);
  return {
    recorded: true,
    message: null,
    receipt,
    record: describeRecord(compareWithRecord(record, fingerprint, readableTitles(receipt), context)),
    fingerprintHash: hash,
  };
}
