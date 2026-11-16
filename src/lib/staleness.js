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

/** Bump when the record shape changes, so old records are ignored rather than misread. */
export const RECORD_VERSION = 1;

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
 */
export function makeRecord(receipt, fingerprint) {
  return {
    v: RECORD_VERSION,
    recordedAt: receipt.checkedAt,
    overall: receipt.overall,
    pages: fingerprint,
  };
}

const WAS = { supports: 'supported the task', conflicts: 'conflicted with the task', missing: 'stated no decision' };
const IS = { supports: 'supports the task', conflicts: 'conflicts with the task', missing: 'states no decision' };

/**
 * Compares a stored record with the current check.
 *
 * @param {object|undefined} record what was stored, or undefined
 * @param {Array} current fingerprint of the current check
 * @param {Object<string, string>} titles page id to title, only for pages the viewer can read now
 * @returns {{state: 'none'|'current'|'stale', recordedAt?: string, changes: Array<{pageId: string|null, text: string}>}}
 */
export function compareWithRecord(record, current, titles) {
  if (!record || record.v !== RECORD_VERSION || !Array.isArray(record.pages)) return { state: 'none', changes: [] };

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

  return { state: changes.length ? 'stale' : 'current', recordedAt: record.recordedAt, changes };
}
