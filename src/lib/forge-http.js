/**
 * The Jira and Confluence calls Decision receipt makes, all as the current user.
 * Shared by the panel's resolver and the Rovo actions, so both read exactly the same way.
 */
import api, { route } from '@forge/api';
import { hostOf } from './links.js';

const json = { headers: { Accept: 'application/json' } };

export const forgeHttp = {
  issue: (issueKey) => api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary&expand=changelog`, json),
  remoteLinks: (issueKey) => api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/remotelink`, json),
  confluencePage: (pageId) => api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}?body-format=storage`, json),
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * The current site's host. Modules get it from their context; a Rovo action called
 * outside an issue page may not, so it falls back to Jira's server info, which needs
 * no extra scope.
 * @param {object} context
 */
export async function siteHostOf(context) {
  const fromContext =
    hostOf(context?.siteUrl) || hostOf(context?.extension?.location) || hostOf(context?.jira?.url) || hostOf(context?.confluence?.url);
  if (fromContext) return fromContext;
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/serverInfo`, json);
    if (res.status === 200) return hostOf((await res.json()).baseUrl);
  } catch (err) {
    if (err?.name === 'NEEDS_AUTHENTICATION_ERR') throw err;
  }
  return null;
}
