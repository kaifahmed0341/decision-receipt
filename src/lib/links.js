/**
 * Turns the remote links on a Jira issue into the list of Confluence pages to check.
 *
 * Decision receipt only checks pages that someone linked to the issue on purpose.
 * Jira stores those as "remote links". When a person uses "Link Confluence page" in
 * Jira, the link carries application type `com.atlassian.confluence` and a
 * `globalId` of the form `appId=<id>&pageId=<pageId>`. Links added through the
 * REST API or pasted as a web link usually only carry a URL, so we also read the
 * page id from the common Confluence URL shapes.
 *
 * Only links that point at the same site as the Jira issue are checked. A link to
 * another site is reported as "outside this site" and never fetched.
 */

// Confluence page URL shapes we accept, newest first.
const PAGE_URL_PATTERNS = [
  /\/wiki\/spaces\/[^/]+\/pages\/(\d+)/, // /wiki/spaces/KEY/pages/123/Title
  /\/wiki\/pages\/viewpage\.action\?(?:.*&)?pageId=(\d+)/, // legacy view URL
  /\/wiki\/.*[?&]pageId=(\d+)/, // any other wiki URL with a pageId parameter
  /\/wiki\/x\/[A-Za-z0-9_-]+/, // tiny links, recognised but not resolvable
];

/**
 * Reads a numeric page id from a remote link's globalId, if it has one.
 * @param {string} globalId
 * @returns {string|null}
 */
export function pageIdFromGlobalId(globalId) {
  if (typeof globalId !== 'string') return null;
  const match = globalId.match(/(?:^|&)pageId=(\d+)(?:&|$)/);
  return match ? match[1] : null;
}

/**
 * Reads a numeric page id from a Confluence URL, if it has one.
 * @param {string} url
 * @returns {string|null}
 */
export function pageIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  for (const pattern of PAGE_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

/**
 * Returns the host name of a URL, or null when the string is not a URL.
 * @param {string} url
 */
export function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch (e) {
    return null;
  }
}

/**
 * Is this remote link a Confluence page link at all?
 * @param {object} link a Jira remote link as returned by GET /issue/{key}/remotelink
 */
export function looksLikeConfluenceLink(link) {
  const appType = link?.application?.type || '';
  const url = link?.object?.url || '';
  return appType === 'com.atlassian.confluence' || /\/wiki\//.test(url);
}

/**
 * Splits an issue's remote links into Confluence pages on this site, links to other
 * sites, and links we cannot read a page id from.
 *
 * @param {Array<object>} remoteLinks raw remote links from Jira
 * @param {string|null} siteHost host of the current site, e.g. "example.atlassian.net"
 * @param {number} maxPages how many pages to check at most, to stay inside time limits
 * @returns {{pages: Array<{pageId: string, url: string, linkId: number}>, otherSite: number, unreadable: number, skipped: number}}
 */
export function confluencePagesFromLinks(remoteLinks, siteHost, maxPages = 10) {
  const pages = [];
  const seen = new Set();
  let otherSite = 0;
  let unreadable = 0;
  let skipped = 0;

  for (const link of Array.isArray(remoteLinks) ? remoteLinks : []) {
    if (!looksLikeConfluenceLink(link)) continue;
    const url = link?.object?.url || '';
    const host = hostOf(url);

    // A link that names another host, or any absolute link when the site is unknown, is never
    // fetched: the page id would be looked up on this site and could name a different page.
    // Relative URLs are treated as this site.
    if (host && (!siteHost || host !== siteHost.toLowerCase())) {
      otherSite += 1;
      continue;
    }

    const pageId = pageIdFromGlobalId(link.globalId) || pageIdFromUrl(url);
    if (!pageId) {
      unreadable += 1;
      continue;
    }
    if (seen.has(pageId)) continue; // the same page linked twice counts once
    seen.add(pageId);

    if (pages.length >= maxPages) {
      skipped += 1;
      continue;
    }
    pages.push({ pageId, url, linkId: link.id });
  }

  return { pages, otherSite, unreadable, skipped };
}
