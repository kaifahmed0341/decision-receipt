/**
 * Backend for the Decision receipt issue panel.
 *
 * Every Jira and Confluence call goes out with api.asUser() (see lib/forge-http.js), so
 * it runs with the permissions of the person looking at the issue. The app never reads a
 * page with its own identity, which means the panel cannot show anything the viewer
 * could not open themselves.
 *
 * The only write is to the app's own key-value storage: a reviewer's recorded check
 * (page ids, versions and verdicts, no page text), kept per site, issue and user.
 * Nothing is written to Jira or Confluence.
 */
import Resolver from '@forge/resolver';
import { kvs } from '@forge/kvs';
import { ReceiptError } from '../lib/receipt.js';
import { loadReview, recordReview } from '../lib/review.js';
import { forgeHttp, siteHostOf } from '../lib/forge-http.js';

const resolver = new Resolver();

/** Forge key-value storage, behind the small interface review.js expects. */
const store = {
  get: (key) => kvs.get(key),
  set: (key, value) => kvs.set(key, value),
};

/** Who, where and which issue, from the invocation context. */
async function reviewContext(context) {
  return {
    issueKey: context?.extension?.issue?.key,
    issueId: context?.extension?.issue?.id ? String(context.extension.issue.id) : null,
    siteHost: await siteHostOf(context),
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

resolver.define('getReceipt', ({ context }) => answer(async () => loadReview(await reviewContext(context), forgeHttp, store)));

resolver.define('recordCheck', ({ context, payload }) =>
  answer(async () => recordReview(await reviewContext(context), forgeHttp, store, String(payload?.fingerprintHash || '')))
);

export const handler = resolver.getDefinitions();
