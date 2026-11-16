/**
 * Loads a check with its recorded state, and records a fresh check.
 *
 * `store` is Forge key-value storage in production and a Map in the tests. Records
 * are keyed by site, issue and user (see staleness.js), and hold page ids, versions
 * and verdicts only.
 */
import { createHash } from 'crypto';
import { buildReceipt } from './receipt.js';
import { recordKey, compareWithRecord, makeRecord, fingerprintString } from './staleness.js';
import { formatUtc } from './evidence.js';

/**
 * A short hash of the fingerprint. The panel sends it back when the reviewer records a
 * check, so the server can refuse if the pages changed while the reviewer was reading.
 * Page ids in the fingerprint are the same ids Jira already shows the viewer in the link.
 */
export function fingerprintHash(fingerprint) {
  return createHash('sha256').update(fingerprintString(fingerprint)).digest('hex').slice(0, 32);
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
  if (cmp.state === 'none') {
    return {
      ...cmp,
      label: 'Not recorded',
      appearance: 'default',
      detail: 'You have not recorded a check of this issue. Read the excerpts, then select Record this check.',
    };
  }
  const when = formatUtc(cmp.recordedAt);
  if (cmp.state === 'current') {
    return {
      ...cmp,
      label: 'Recorded check is current',
      appearance: 'success',
      detail: `You recorded a check at ${when}. No linked page has changed since.`,
    };
  }
  return {
    ...cmp,
    label: 'Recorded check is stale',
    appearance: 'removed',
    detail: `Your check recorded at ${when} no longer holds. Read the changed evidence below, then record a fresh check.`,
  };
}

/**
 * Runs a live check and compares it with this user's record.
 * @param {{issueKey: string, siteHost: string|null, cloudId: string, issueId: string, accountId: string}} ctx
 * @param {object} http see receipt.js
 * @param {{get: (k: string) => Promise<any>, set: (k: string, v: any) => Promise<void>}} store
 */
export async function loadReview(ctx, http, store) {
  const { receipt, fingerprint } = await buildReceipt(ctx.issueKey, ctx.siteHost, http);
  const record = await store.get(recordKey(ctx.cloudId, ctx.issueId, ctx.accountId));
  const cmp = compareWithRecord(record, fingerprint, readableTitles(receipt));
  return { receipt, record: describeRecord(cmp), fingerprintHash: fingerprintHash(fingerprint) };
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
  const { receipt, fingerprint } = await buildReceipt(ctx.issueKey, ctx.siteHost, http);
  const hash = fingerprintHash(fingerprint);
  if (hash !== seenHash) {
    return {
      recorded: false,
      message: 'The linked pages changed while you were reading, so nothing was recorded. Read the new evidence, then record again.',
      receipt,
      record: describeRecord(compareWithRecord(await store.get(recordKey(ctx.cloudId, ctx.issueId, ctx.accountId)), fingerprint, readableTitles(receipt))),
      fingerprintHash: hash,
    };
  }
  if (fingerprint.some((p) => p.status !== 'ok' && p.status !== 'unavailable' && p.status !== 'not-current')) {
    return {
      recorded: false,
      message: 'Some pages were not read because of a rate limit, an interrupted request or the time limit. Check again before recording.',
      receipt,
      record: describeRecord(compareWithRecord(await store.get(recordKey(ctx.cloudId, ctx.issueId, ctx.accountId)), fingerprint, readableTitles(receipt))),
      fingerprintHash: hash,
    };
  }
  const record = makeRecord(receipt, fingerprint);
  await store.set(recordKey(ctx.cloudId, ctx.issueId, ctx.accountId), record);
  return {
    recorded: true,
    message: null,
    receipt,
    record: describeRecord(compareWithRecord(record, fingerprint, readableTitles(receipt))),
    fingerprintHash: hash,
  };
}
