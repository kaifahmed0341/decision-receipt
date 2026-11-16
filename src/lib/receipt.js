/**
 * Builds the decision receipt for one issue.
 *
 * The Atlassian calls are passed in as `http`, so the same code runs in Forge (where
 * the calls go out as the current user) and in the tests (where they are fakes).
 *
 * @typedef {{status: number, headers?: {get: (name: string) => string|null}, json: () => Promise<any>}} HttpResponse
 * @typedef {{
 *   issue: (issueKey: string) => Promise<HttpResponse>,
 *   remoteLinks: (issueKey: string) => Promise<HttpResponse>,
 *   confluencePage: (pageId: string) => Promise<HttpResponse>,
 *   now: () => Date,
 *   sleep: (ms: number) => Promise<void>,
 * }} Http
 */

import { confluencePagesFromLinks } from './links.js';
import { storageToText, splitSentences } from './text.js';
import { classifyPage, overallVerdict } from './classify.js';
import { okPageEvidence, problemPageEvidence, linkNotes, OVERALL, formatUtc } from './evidence.js';
import { fingerprintOf } from './staleness.js';

// How often a rate-limited or briefly unavailable request is retried, and the longest wait.
export const MAX_RETRIES = 2;
export const MAX_WAIT_MS = 4000;

// Resolvers have about 25 seconds. No new page read starts after this many milliseconds.
export const TIME_BUDGET_MS = 18000;

// Statuses that mean "try again shortly".
const RETRYABLE = new Set([429, 503]);

/** An error the panel shows as a whole-issue message rather than per page. */
export class ReceiptError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Reads the Retry-After header (seconds) and turns it into a wait, capped at MAX_WAIT_MS.
 * @param {HttpResponse} res
 * @param {number} attempt zero-based retry number, used when the header is missing
 */
export function retryDelayMs(res, attempt) {
  const header = res?.headers?.get ? res.headers.get('retry-after') : null;
  const seconds = header !== null && header !== undefined ? Number(header) : NaN;
  const base = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 500 * 2 ** attempt;
  return Math.min(base, MAX_WAIT_MS);
}

/**
 * Calls `request` and retries on 429 and 503, waiting as the server asks.
 * Errors thrown by the request itself (for example the platform asking the user to
 * grant access) are not caught here; they must reach the platform unchanged.
 * @param {() => Promise<HttpResponse>} request
 * @param {Http} http
 */
export async function withRetry(request, http) {
  let res = await request();
  for (let attempt = 0; attempt < MAX_RETRIES && RETRYABLE.has(res.status); attempt += 1) {
    await http.sleep(retryDelayMs(res, attempt));
    res = await request();
  }
  return res;
}

/**
 * Fetches and classifies one linked page.
 * @param {{pageId: string, url: string}} link
 * @param {{key: string, summary: string}} issue
 * @param {Http} http
 */
export async function checkPage(link, issue, http) {
  let res;
  try {
    res = await withRetry(() => http.confluencePage(link.pageId), http);
  } catch (err) {
    // The platform asking the user to grant access must reach Forge unchanged.
    if (isPlatformAuthError(err)) throw err;
    // Anything else thrown here is a request that did not complete: a dropped
    // connection, a timeout or a proxy failure. It says nothing about the page.
    return problemPageEvidence('interrupted', http.now().toISOString());
  }
  const retrievedAt = http.now().toISOString();

  // Confluence answers 404 both for a deleted page and for a page the user may not see.
  // We do not try to tell them apart, and show neither the title nor the content.
  if (res.status === 403 || res.status === 404) return problemPageEvidence('unavailable', retrievedAt);
  if (RETRYABLE.has(res.status)) return problemPageEvidence('rate-limited', retrievedAt);
  if (res.status !== 200) return problemPageEvidence('error', retrievedAt);

  const body = await res.json();
  if (body.status && body.status !== 'current') return problemPageEvidence('not-current', retrievedAt);

  const text = storageToText(body?.body?.storage?.value || '');
  const result = classifyPage(splitSentences(text), issue);
  return okPageEvidence({
    issue,
    link,
    page: {
      title: body.title,
      version: body?.version?.number,
      editedAt: body?.version?.createdAt,
    },
    retrievedAt,
    result,
  });
}

/**
 * Is this the platform asking the user to grant the app access? Forge handles that
 * error itself by showing a consent prompt, so the app must not swallow it.
 */
export function isPlatformAuthError(err) {
  return err?.name === 'NEEDS_AUTHENTICATION_ERR' || err?.options?.isExpectedError === true;
}

/**
 * Builds the full receipt for an issue.
 *
 * Returns the receipt the panel shows and, separately, a fingerprint for stale
 * detection. The fingerprint knows the id of every linked page, including pages the
 * viewer cannot read, so it stays on the server and is never sent to the panel.
 *
 * @param {string} issueKey e.g. "DREC-1"
 * @param {string|null} siteHost host of the current site, used to ignore links to other sites
 * @param {Http} http
 * @param {{budgetMs?: number}} [options] stop starting new page reads after this long
 * @returns {Promise<{receipt: object, fingerprint: Array}>}
 */
export async function buildReceipt(issueKey, siteHost, http, { budgetMs = TIME_BUDGET_MS } = {}) {
  const started = http.now().getTime();
  if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(issueKey || '')) {
    throw new ReceiptError('bad-issue', 'The panel could not tell which issue it is on.');
  }

  const issueRes = await withRetry(() => http.issue(issueKey), http);
  if (issueRes.status === 404 || issueRes.status === 403) {
    throw new ReceiptError('issue-unavailable', 'This issue is not available to you.');
  }
  if (RETRYABLE.has(issueRes.status)) {
    throw new ReceiptError('rate-limited', 'Jira asked us to slow down. Wait a minute, then select Check again.');
  }
  if (issueRes.status !== 200) throw new ReceiptError('jira-error', `Jira returned an error (${issueRes.status}).`);
  const issueBody = await issueRes.json();
  const issue = { key: issueBody.key || issueKey, summary: issueBody?.fields?.summary || '' };

  const linksRes = await withRetry(() => http.remoteLinks(issueKey), http);
  if (RETRYABLE.has(linksRes.status)) {
    throw new ReceiptError('rate-limited', 'Jira asked us to slow down. Wait a minute, then select Check again.');
  }
  if (linksRes.status !== 200) {
    throw new ReceiptError('jira-error', `Jira returned an error (${linksRes.status}) for this issue's links.`);
  }
  const remoteLinks = await linksRes.json();
  const { pages: links, ...counts } = confluencePagesFromLinks(remoteLinks, siteHost);

  // Pages are read one after another so a burst does not trip the rate limit. When the
  // time budget runs out, the remaining pages are reported as not read rather than guessed.
  const pages = [];
  const fingerprint = [];
  for (const link of links) {
    const evidence =
      http.now().getTime() - started > budgetMs
        ? problemPageEvidence('timed-out', http.now().toISOString())
        : await checkPage(link, issue, http);
    pages.push(evidence);
    fingerprint.push(...fingerprintOf([{ ...evidence, pageId: link.pageId }]));
  }

  const overall = overallVerdict(pages);
  const checkedAt = http.now().toISOString();
  const receipt = {
    issue,
    checkedAt,
    checkedAtLabel: formatUtc(checkedAt),
    overall,
    overallLabel: OVERALL[overall].label,
    overallAppearance: OVERALL[overall].appearance,
    overallDetail: OVERALL[overall].detail,
    pages,
    notes: linkNotes(counts),
  };
  return { receipt, fingerprint };
}
