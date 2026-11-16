/**
 * Backend for the Decision receipt issue panel.
 *
 * Every Jira and Confluence call goes out with api.asUser(), so it runs with the
 * permissions of the person looking at the issue. The app never reads a page with its
 * own identity, which means the panel cannot show anything the viewer could not open
 * themselves. Nothing is written to Jira, Confluence or app storage.
 */
import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { buildReceipt, ReceiptError } from '../lib/receipt.js';
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

/**
 * Works out the current site's host from the invocation context.
 * @param {object} context
 */
function siteHostFrom(context) {
  return hostOf(context?.siteUrl) || hostOf(context?.extension?.location) || null;
}

resolver.define('getReceipt', async ({ context }) => {
  const issueKey = context?.extension?.issue?.key;
  try {
    const receipt = await buildReceipt(issueKey, siteHostFrom(context), forgeHttp);
    return { ok: true, receipt };
  } catch (err) {
    // Known problems become a plain message. Anything else, including the platform
    // asking the user to grant access, is rethrown so Forge can handle it.
    if (err instanceof ReceiptError) return { ok: false, code: err.code, message: err.message };
    throw err;
  }
});

export const handler = resolver.getDefinitions();
