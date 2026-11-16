#!/usr/bin/env node
/**
 * Creates the fictional demonstration data on an Atlassian site:
 * the DREC Jira project, the DRDEMO Confluence space, the decision pages and the
 * issues, and links each issue to its pages with a Jira remote link.
 *
 * Safe to run again: anything that already exists is reused, not duplicated.
 *
 * Usage, with nothing installed but Node.js 20 or later:
 *   node scripts/fixtures.mjs
 * It asks for the site address, your Atlassian email and an API token
 * (https://id.atlassian.com/manage-profile/security/api-tokens). The token is not
 * shown while you type and is not saved. Or set them up front:
 *   ATLASSIAN_SITE=https://your-site.atlassian.net ATLASSIAN_EMAIL=you@example.com \
 *   ATLASSIAN_API_TOKEN=... node scripts/fixtures.mjs
 *
 * The account needs permission to create a Jira project and a Confluence space,
 * which a site admin has by default. FIXTURE_PROJECT_KEY picks another project key
 * if DREC is taken on your site. FORGE_EMAIL and FORGE_API_TOKEN are accepted too.
 */
import { createInterface } from 'node:readline';
import { PROJECT as BASE_PROJECT, SPACE, PAGES as BASE_PAGES, ISSUES } from '../fixtures/data.mjs';

/**
 * Asks questions on the terminal through one shared reader, so typed or pasted answers
 * are never lost between questions. What is typed after a secret question is not shown.
 */
let reader = null;
let muted = false;
const queued = [];
const waiting = [];
function startReader() {
  reader = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  const write = reader._writeToOutput?.bind(reader);
  if (write) reader._writeToOutput = (s) => (muted ? undefined : write(s));
  reader.on('line', (line) => (waiting.length ? waiting.shift()(line.trim()) : queued.push(line.trim())));
  reader.on('close', () => {
    while (waiting.length) waiting.shift()('');
  });
}
function ask(question, secret = false) {
  if (!reader) startReader();
  process.stdout.write(question);
  muted = secret;
  return new Promise((resolve) => {
    const done = (answer) => {
      muted = false;
      if (secret) process.stdout.write('\n');
      resolve(answer);
    };
    if (queued.length) done(queued.shift());
    else waiting.push(done);
  });
}

let site = process.env.ATLASSIAN_SITE || '';
let email = process.env.ATLASSIAN_EMAIL || process.env.FORGE_EMAIL || '';
let token = process.env.ATLASSIAN_API_TOKEN || process.env.FORGE_API_TOKEN || '';
if (!site) site = await ask('Site address (for example https://your-site.atlassian.net): ');
if (!email) email = await ask('Your Atlassian account email: ');
if (!token) token = await ask('Your Atlassian API token (hidden): ', true);
if (reader) reader.close();
site = site.trim().replace(/\/+$/, '');
if (!/^https?:\/\//.test(site)) site = `https://${site}`;
if (!site || !email || !token) {
  console.error('A site address, an email and an API token are all needed.');
  process.exit(2);
}
const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

// The page text names issues as DREC-1 to DREC-10. With another project key, every
// page and expectation is rewritten to that key, so the rules still find them.
const KEY = (process.env.FIXTURE_PROJECT_KEY || BASE_PROJECT.key).toUpperCase();
if (!/^[A-Z][A-Z0-9]{1,9}$/.test(KEY)) {
  console.error('FIXTURE_PROJECT_KEY must be 2 to 10 capital letters or digits, starting with a letter.');
  process.exit(2);
}
const rekey = (s) => s.replace(/\bDREC-(\d+)/g, `${KEY}-$1`);
const PROJECT = { ...BASE_PROJECT, key: KEY };
const PAGES = Object.fromEntries(
  Object.entries(BASE_PAGES).map(([k, p]) => [k, { ...p, body: rekey(p.body), ...(p.editedBody ? { editedBody: rekey(p.editedBody) } : {}) }])
);

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
  if (existing.status === 200) {
    if (existing.body.name !== PROJECT.name) {
      throw new Error(`Project ${PROJECT.key} already exists on this site as "${existing.body.name}". Run again with FIXTURE_PROJECT_KEY set to an unused key, for example DRDEMO1.`);
    }
    return existing.body;
  }
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

/**
 * Lets only the given account read or edit the page. Other users, including site
 * users with access to the space, then get a 404 for it.
 */
async function restrictToAccount(pageId, accountId) {
  const user = [{ type: 'known', accountId }];
  await must('PUT', `/wiki/rest/api/content/${pageId}/restriction`, [
    { operation: 'read', restrictions: { user, group: [] } },
    { operation: 'update', restrictions: { user, group: [] } },
  ]);
}

async function ensurePage(spaceId, page, me) {
  const existing = await findPage(spaceId, page.title, ['current', 'trashed']);
  let id = existing?.id;
  let status = existing?.status;
  if (!existing) {
    const created = await must('POST', '/wiki/api/v2/pages', {
      spaceId,
      status: 'current',
      title: page.title,
      body: { representation: 'storage', value: page.body },
    });
    id = created.id;
    status = 'current';
  }
  if (page.restrictToOwner) await restrictToAccount(id, me.accountId);
  if (page.trash && status === 'current') {
    await must('DELETE', `/wiki/api/v2/pages/${id}`);
    status = 'trashed';
  }
  return { id, status: page.restrictToOwner ? `${status}, restricted to ${me.displayName}` : status };
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
  // Keep the same globalId shape on reruns so Jira updates the link rather than adding one.
  await must('POST', `/rest/api/3/issue/${issueKey}/remotelink`, {
    globalId: `appId=decision-receipt-fixtures&pageId=${pageId}`,
    application: { type: 'com.atlassian.confluence', name: 'Confluence' },
    relationship: 'Wiki Page',
    object: { url: `${site}/wiki/spaces/${SPACE.key}/pages/${pageId}`, title },
  });
}

/** Checks the credentials and the products before changing anything. */
async function preflight() {
  const me = await call('GET', '/rest/api/3/myself');
  if (me.status === 401) throw new Error('The site refused the email and API token. Check both, and that the token belongs to this email.');
  if (me.status === 404 || me.status >= 500) throw new Error(`No Jira found at ${site}. Check the site address.`);
  if (me.status !== 200) throw new Error(`Jira answered ${me.status} for your account.`);
  const wiki = await call('GET', '/wiki/api/v2/spaces?limit=1');
  if (wiki.status === 404) throw new Error(`No Confluence found at ${site}. The demo needs Jira and Confluence on the same site.`);
  if (wiki.status === 401 || wiki.status === 403) throw new Error('Your account cannot use Confluence on this site.');
  console.log(`Signed in to ${site} as ${me.body.displayName}.`);
}

async function main() {
  await preflight();
  const project = await ensureProject();
  console.log(`Project ${project.key}: ${project.name}`);
  const space = await ensureSpace();
  console.log(`Space ${space.key}: ${space.name} (id ${space.id})`);

  const me = await must('GET', '/rest/api/3/myself');
  const pageIds = {};
  for (const [localId, page] of Object.entries(PAGES)) {
    const { id, status } = await ensurePage(space.id, page, me);
    pageIds[localId] = id;
    console.log(`Page ${id} [${status}]: ${page.title}`);
  }

  for (const issue of ISSUES) {
    const key = await ensureIssue({ ...issue, summary: issue.summary });
    for (const localId of issue.links) {
      await linkPage(key, pageIds[localId], PAGES[localId].linkTitle || PAGES[localId].title);
    }
    console.log(`Issue ${key}: ${issue.summary} -> expected "${issue.expected}", links ${issue.links.length}`);
  }
  console.log('');
  console.log(`Done. Open ${site}/browse/${PROJECT.key}-2, select View app actions under the summary,`);
  console.log('choose Decision receipt, and compare with the table in the README.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
