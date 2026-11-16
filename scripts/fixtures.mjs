#!/usr/bin/env node
/**
 * Creates the fictional demonstration data on an Atlassian site:
 * the DREC Jira project, the DRDEMO Confluence space, the decision pages and the
 * issues, and links each issue to its pages with a Jira remote link.
 *
 * Safe to run again: anything that already exists is reused, not duplicated.
 *
 * Usage:
 *   ATLASSIAN_SITE=https://your-site.atlassian.net \
 *   ATLASSIAN_EMAIL=you@example.com \
 *   ATLASSIAN_API_TOKEN=... \
 *   node scripts/fixtures.mjs
 *
 * The account needs permission to create a Jira project and a Confluence space,
 * which a site admin has by default. FORGE_EMAIL is accepted in place of
 * ATLASSIAN_EMAIL so the Forge CLI's settings can be reused.
 */
import { PROJECT, SPACE, PAGES, ISSUES } from '../fixtures/data.mjs';

const site = (process.env.ATLASSIAN_SITE || '').replace(/\/+$/, '');
const email = process.env.ATLASSIAN_EMAIL || process.env.FORGE_EMAIL;
const token = process.env.ATLASSIAN_API_TOKEN || process.env.FORGE_API_TOKEN;
if (!site || !email || !token) {
  console.error('Set ATLASSIAN_SITE, ATLASSIAN_EMAIL (or FORGE_EMAIL) and ATLASSIAN_API_TOKEN first.');
  process.exit(2);
}
const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

/** Calls the site's REST API and returns {status, body}. Retries once on 429. */
async function call(method, path, body) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(`${site}${path}`, {
      method,
      headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 2) {
      const wait = Math.min(Number(res.headers.get('retry-after') || 2) * 1000, 10000);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  }
  throw new Error('unreachable');
}

/** Like call(), but stops the script on an unexpected status. */
async function must(method, path, body, ok = [200, 201, 204]) {
  const res = await call(method, path, body);
  if (!ok.includes(res.status)) {
    const detail = typeof res.body === 'string' ? res.body.slice(0, 300) : JSON.stringify(res.body).slice(0, 300);
    throw new Error(`${method} ${path} returned ${res.status}: ${detail}`);
  }
  return res.body;
}

const adf = (text) => ({
  type: 'doc',
  version: 1,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

async function ensureProject() {
  const existing = await call('GET', `/rest/api/3/project/${PROJECT.key}`);
  if (existing.status === 200) return existing.body;
  const me = await must('GET', '/rest/api/3/myself');
  const templates = [
    'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic',
    'com.pyxis.greenhopper.jira:gh-simplified-scrum-classic',
    'com.pyxis.greenhopper.jira:gh-simplified-basic',
  ];
  let lastError;
  for (const projectTemplateKey of templates) {
    const res = await call('POST', '/rest/api/3/project', {
      key: PROJECT.key,
      name: PROJECT.name,
      projectTypeKey: 'software',
      projectTemplateKey,
      leadAccountId: me.accountId,
      assigneeType: 'UNASSIGNED',
      description: 'Fictional demonstration data for the Decision receipt Forge app.',
    });
    if (res.status === 201) return must('GET', `/rest/api/3/project/${PROJECT.key}`);
    lastError = `${res.status} ${JSON.stringify(res.body).slice(0, 200)}`;
  }
  throw new Error(`Could not create project ${PROJECT.key}: ${lastError}`);
}

async function ensureSpace() {
  const found = await must('GET', `/wiki/api/v2/spaces?keys=${SPACE.key}`);
  if (found.results && found.results.length) return found.results[0];
  const created = await call('POST', '/wiki/api/v2/spaces', { key: SPACE.key, name: SPACE.name });
  if (created.status === 200 || created.status === 201) return created.body;
  // Older sites only offer the v1 endpoint.
  await must('POST', '/wiki/rest/api/space', { key: SPACE.key, name: SPACE.name });
  const again = await must('GET', `/wiki/api/v2/spaces?keys=${SPACE.key}`);
  return again.results[0];
}

/** Finds a page by title in the space, in any of the given statuses. */
async function findPage(spaceId, title, statuses) {
  const q = new URLSearchParams({ title, status: statuses.join(',') });
  const res = await must('GET', `/wiki/api/v2/spaces/${spaceId}/pages?${q}`);
  return (res.results || [])[0] || null;
}

async function ensurePage(spaceId, page) {
  const existing = await findPage(spaceId, page.title, ['current', 'trashed']);
  if (existing) {
    if (page.trash && existing.status === 'current') await must('DELETE', `/wiki/api/v2/pages/${existing.id}`);
    return { id: existing.id, status: page.trash ? 'trashed' : existing.status };
  }
  const created = await must('POST', '/wiki/api/v2/pages', {
    spaceId,
    status: 'current',
    title: page.title,
    body: { representation: 'storage', value: page.body },
  });
  if (page.trash) await must('DELETE', `/wiki/api/v2/pages/${created.id}`);
  return { id: created.id, status: page.trash ? 'trashed' : 'current' };
}

async function ensureIssue(issue) {
  const jql = `project = ${PROJECT.key} AND summary ~ "\\"${issue.summary.replace(/"/g, '')}\\""`;
  const search = await must('POST', '/rest/api/3/search/jql', { jql, fields: ['summary'], maxResults: 20 });
  const match = (search.issues || []).find((i) => i.fields.summary === issue.summary);
  if (match) return match.key;
  const created = await must('POST', '/rest/api/3/issue', {
    fields: {
      project: { key: PROJECT.key },
      summary: issue.summary,
      issuetype: { name: 'Task' },
      description: adf(issue.description),
    },
  });
  return created.key;
}

/**
 * Links a page to an issue the way Jira's own "Confluence page" link does: a remote
 * link with application type com.atlassian.confluence and the page id in the globalId.
 * Posting the same globalId again updates the link instead of adding a second one.
 */
async function linkPage(issueKey, pageId, title) {
  await must('POST', `/rest/api/3/issue/${issueKey}/remotelink`, {
    globalId: `appId=decision-receipt-fixtures&pageId=${pageId}`,
    application: { type: 'com.atlassian.confluence', name: 'Confluence' },
    relationship: 'Wiki Page',
    object: { url: `${site}/wiki/spaces/${SPACE.key}/pages/${pageId}`, title },
  });
}

async function main() {
  const project = await ensureProject();
  console.log(`Project ${project.key}: ${project.name}`);
  const space = await ensureSpace();
  console.log(`Space ${space.key}: ${space.name} (id ${space.id})`);

  const pageIds = {};
  for (const [localId, page] of Object.entries(PAGES)) {
    const { id, status } = await ensurePage(space.id, page);
    pageIds[localId] = id;
    console.log(`Page ${id} [${status}]: ${page.title}`);
  }

  for (const issue of ISSUES) {
    const key = await ensureIssue(issue);
    for (const localId of issue.links) await linkPage(key, pageIds[localId], PAGES[localId].title);
    console.log(`Issue ${key}: ${issue.summary} -> expected "${issue.expected}", links ${issue.links.length}`);
  }
  console.log(`Done. Open ${site}/browse/${PROJECT.key}-1 and add the Decision receipt panel.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
