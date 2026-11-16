/**
 * Rovo actions. All three are read-only (actionVerb GET) and return the same receipt
 * the issue panel shows, computed by the same code with the user's own permissions.
 * They never write to Jira, Confluence or app storage.
 */
import { kvs } from '@forge/kvs';
import { forgeHttp, siteHostOf } from '../lib/forge-http.js';
import { buildReceipt, ReceiptError } from '../lib/receipt.js';
import { loadReview } from '../lib/review.js';
import { RULES_VERSION } from '../lib/classify.js';
import { issueKeyFrom, receiptSummary, pageEvidence, explainPage, RECEIPT_NOTICE } from '../lib/agent.js';

/** Runs an action and turns known problems into a plain answer for the agent. */
async function run(payload, context, work) {
  // Answers carry the reader's own access, so they are only given to a signed-in user.
  if (!(context?.accountId || context?.principal?.accountId)) {
    return { notice: RECEIPT_NOTICE, error: 'Decision receipt answers only a signed-in user, because it reads pages with that user\'s access.' };
  }
  const issueKey = issueKeyFrom(payload);
  if (!issueKey) return { notice: RECEIPT_NOTICE, error: 'Name a Jira issue key, for example DREC-2, or ask from an open issue.' };
  try {
    return await work(issueKey, await siteHostOf({ ...context, ...(payload?.context || {}) }));
  } catch (err) {
    if (err instanceof ReceiptError) return { notice: RECEIPT_NOTICE, issue: { key: issueKey }, error: err.message };
    throw err;
  }
}

/** list-linked-decisions: the overall result and every linked page, with the user's recorded check. */
export async function listLinkedDecisions(payload, context) {
  return run(payload, context, async (issueKey, siteHost) => {
    // The recorded check is read, never written, and only for the user asking.
    const store = { get: (k) => kvs.get(k), set: async () => {} };
    const ctx = {
      issueKey,
      issueId: null, // taken from Jira's answer, so the panel and the agent share one record
      siteHost,
      cloudId: payload?.context?.cloudId || context?.cloudId,
      accountId: context?.accountId || context?.principal?.accountId,
    };
    const { receipt, record } = await loadReview(ctx, forgeHttp, store);
    return receiptSummary(receipt, record);
  });
}

/** get-page-evidence: one linked page's verdict and excerpts, word for word. */
export async function getPageEvidence(payload, context) {
  return run(payload, context, async (issueKey, siteHost) => {
    const { receipt } = await buildReceipt(issueKey, siteHost, forgeHttp);
    return pageEvidence(receipt, payload?.page);
  });
}

/** explain-page-label: why the rules gave a page its label. */
export async function explainPageLabel(payload, context) {
  return run(payload, context, async (issueKey, siteHost) => {
    const { receipt } = await buildReceipt(issueKey, siteHost, forgeHttp);
    return explainPage(receipt, payload?.page, RULES_VERSION);
  });
}
