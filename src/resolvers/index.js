/**
 * Backend for the Decision receipt issue panel.
 *
 * Every Jira and Confluence call goes out with api.asUser(), so it runs with the
 * permissions of the person looking at the issue. The app never reads a page with its
 * own identity, which means the panel cannot show anything the viewer could not open
 * themselves.
 *
 * The only write is to the app's own key-value storage: a reviewer's recorded check
 * (page ids, versions and verdicts, no page text), kept per site, issue and user.
 * Nothing is written to Jira or Confluence.
 */
import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { ReceiptError } from '../lib/receipt.js';
import { loadReview, recordReview } from '../lib/review.js';
import { hostOf } from '../lib/links.js';

const resolver = new Resolver();

/** The calls the receipt needs, made as the current user. */
const forgeHttp = {
  issue: (issueKey) =>
    api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary`, {
      headers: { Accept: 'application/json' },
    }),
  remoteLinks: (issueKey) =>
    api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/remotelink`, {
      headers: { Accept: 'application/json' },
    }),
  confluencePage: (pageId) =>
    api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}?body-format=storage`, {
      headers: { Accept: 'application/json' },
    }),
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Forge key-value storage, behind the small interface review.js expects. */
const store = {
  get: (key) => kvs.get(key),
  set: (key, value) => kvs.set(key, value),
};

/** Who, where and which issue, from the invocation context. */
function reviewContext(context) {
  return {
    issueKey: context?.extension?.issue?.key,
    issueId: context?.extension?.issue?.id,
    siteHost: hostOf(context?.siteUrl) || hostOf(context?.extension?.location) || null,
    cloudId: context?.cloudId,
    accountId: context?.accountId,
  };
}

/**
 * Runs `work` and turns known problems into a plain message. Anything else, including
 * the platform asking the user to grant access, is rethrown so Forge can handle it.
 */
async function answer(work) {
  try {
    return { ok: true, ...(await work()) };
  } catch (err) {
    if (err instanceof ReceiptError) return { ok: false, code: err.code, message: err.message };
    throw err;
  }
}

resolver.define('getReceipt', ({ context }) => answer(() => loadReview(reviewContext(context), forgeHttp, store)));

resolver.define('recordCheck', ({ context, payload }) =>
  answer(() => recordReview(reviewContext(context), forgeHttp, store, String(payload?.fingerprintHash || '')))
);

export const handler = resolver.getDefinitions();
