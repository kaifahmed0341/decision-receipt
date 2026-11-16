/**
 * Recorded checks and stale detection.
 *
 * A reviewer can record a check once they have read the evidence. The record keeps
 * only what is needed to notice a change later: for each linked page, its id, whether
 * it could be read, its version and the verdict. It holds no page text and no titles.
 *
 * Records are stored per site, per issue and per user. One reviewer's record is never
 * shown to another, so a record cannot reveal a page that the second reviewer cannot
 * open.
 *
 * When the panel opens, the live check is compared with the record. Any edited page,
 * added or removed link, or page that became readable or unreadable makes the record
 * stale. A stale record stays stale until the reviewer records a fresh check.
 */

import { createHash } from 'crypto';

/** Bump when the record shape changes. Older records are reported as stale, never misread. */
export const RECORD_VERSION = 2;

/** A short hash of the issue summary, so a record notices when the task is reworded. */
export function summaryHash(summary) {
  return createHash('sha256').update(String(summary || '')).digest('hex').slice(0, 16);
}

/**
 * The storage key for one user's record of one issue on one site.
 * Only letters, digits, colons, dots and dashes are used.
 */
export function recordKey(cloudId, issueId, accountId) {
  const clean = (s) => String(s || 'unknown').replace(/[^A-Za-z0-9:.-]/g, '-');
  return `check.v${RECORD_VERSION}:${clean(cloudId)}:${clean(issueId)}:${clean(accountId)}`;
}

/**
 * The comparable state of a check: one entry per linked page, in link order.
 * Built on the server from the internal receipt, which still knows every page id.
 * @param {Array<{pageId: string, status: string, version?: number, verdict?: string}>} pages
 */
export function fingerprintOf(pages) {
  return pages.map((p) => ({
    pageId: String(p.pageId),
    status: p.status,
    version: p.status === 'ok' ? p.version : null,
    verdict: p.status === 'ok' ? p.verdict : null,
  }));
}

/** A stable string form of a fingerprint, used to spot a change while the reviewer reads. */
export function fingerprintString(fingerprint) {
  return fingerprint.map((p) => `${p.pageId}|${p.status}|${p.version ?? ''}|${p.verdict ?? ''}`).join(';');
}

/**
 * Builds the record to store.
 * @param {{checkedAt: string, overall: string}} receipt
 * @param {Array} fingerprint
 * @param {{summaryHash: string, rulesVersion: number, unread: object}} context
 */
export function makeRecord(receipt, fingerprint, context = {}) {
  return {
    v: RECORD_VERSION,
    recordedAt: receipt.checkedAt,
    overall: receipt.overall,
    summaryHash: context.summaryHash ?? null,
    rulesVersion: context.rulesVersion ?? null,
    unread: unreadCounts(context.unread),
    pages: fingerprint,
  };
}

/** The counts of links the panel could not read, in a fixed shape. */
export function unreadCounts(u = {}) {
  return { otherSite: u?.otherSite || 0, unreadable: u?.unreadable || 0, skipped: u?.skipped || 0 };
}

const WAS = { supports: 'supported the task', conflicts: 'conflicted with the task', missing: 'stated no decision' };
const IS = { supports: 'supports the task', conflicts: 'conflicts with the task', missing: 'states no decision' };

/**
 * Compares a stored record with the current check.
 *
 * @param {object|undefined} record what was stored, or undefined
 * @param {Array} current fingerprint of the current check
 * @param {Object<string, string>} titles page id to title, only for pages the viewer can read now
 * @param {{summaryHash?: string, rulesVersion?: number, unread?: object}} [context] the current check's context
 * @returns {{state: 'none'|'current'|'stale', recordedAt?: string, recordedOverall?: string, changes: Array<{pageId: string|null, text: string}>}}
 */
export function compareWithRecord(record, current, titles, context = {}) {
  if (!record || !Array.isArray(record.pages)) return { state: 'none', changes: [] };
  if (record.v !== RECORD_VERSION) {
    return {
      state: 'stale',
      recordedAt: record.recordedAt,
      recordedOverall: record.overall,
      changes: [{ pageId: null, text: 'The app changed how it checks pages since your recorded check.' }],
    };
  }

  const before = new Map(record.pages.map((p) => [p.pageId, p]));
  const now = new Map(current.map((p) => [p.pageId, p]));
  const changes = [];
  // A page is named only when the viewer can read it now; otherwise it is described by position.
  const name = (id) => (titles[id] ? `"${titles[id]}"` : 'A linked page');

  for (const [id, cur] of now) {
    const old = before.get(id);
    if (!old) {
      changes.push({ pageId: id, text: `${name(id)} was linked after your recorded check.` });
      continue;
    }
    if (old.status === 'ok' && cur.status === 'ok') {
      if (old.version !== cur.version) {
        let text = `${name(id)} changed from version ${old.version} to version ${cur.version}.`;
        if (old.verdict !== cur.verdict) {
          text += ` Before, it ${WAS[old.verdict] || 'had another result'}. Now it ${IS[cur.verdict] || 'has another result'}.`;
        }
        changes.push({ pageId: id, text });
      } else if (old.verdict !== cur.verdict) {
        // Same page version, different result: the task or the rules changed.
        changes.push({
          pageId: id,
          text: `${name(id)} has not changed, but its result has. Before, it ${WAS[old.verdict] || 'had another result'}. Now it ${IS[cur.verdict] || 'has another result'}.`,
        });
      }
    } else if (old.status === 'ok' && cur.status !== 'ok') {
      changes.push({ pageId: id, text: 'A linked page you could read at your recorded check cannot be read now.' });
    } else if (old.status !== 'ok' && cur.status === 'ok') {
      changes.push({ pageId: id, text: `${name(id)} could not be read at your recorded check and can be read now.` });
    }
  }
  const removed = [...before.keys()].filter((id) => !now.has(id)).length;
  if (removed) {
    changes.push({
      pageId: null,
      text: `${removed} ${removed === 1 ? 'page linked at your recorded check is' : 'pages linked at your recorded check are'} no longer linked.`,
    });
  }

  if (context.summaryHash && record.summaryHash && context.summaryHash !== record.summaryHash) {
    changes.unshift({ pageId: null, text: 'The issue summary changed since your recorded check.' });
  }
  if (context.rulesVersion && record.rulesVersion && context.rulesVersion !== record.rulesVersion) {
    changes.push({ pageId: null, text: 'The app changed how it checks pages since your recorded check.' });
  }
  if (context.unread) {
    const a = unreadCounts(record.unread);
    const b = unreadCounts(context.unread);
    if (a.otherSite !== b.otherSite || a.unreadable !== b.unreadable || a.skipped !== b.skipped) {
      changes.push({ pageId: null, text: 'The links the panel cannot read have changed since your recorded check.' });
    }
  }

  return { state: changes.length ? 'stale' : 'current', recordedAt: record.recordedAt, recordedOverall: record.overall, changes };
}
