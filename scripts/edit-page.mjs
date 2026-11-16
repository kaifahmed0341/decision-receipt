#!/usr/bin/env node
/**
 * Edits a fixture page so a recorded check goes stale. By default it applies the
 * `editedBody` of the "Decision: admin console sign-in" page; with --restore it puts
 * the original body back. Each run adds a new page version.
 *
 * Usage (same environment variables as scripts/fixtures.mjs):
 *   node scripts/edit-page.mjs            # approve -> deferred
 *   node scripts/edit-page.mjs --restore  # deferred -> approve
 */
import { PAGES, SPACE } from '../fixtures/data.mjs';

const site = (process.env.ATLASSIAN_SITE || '').replace(/\/+$/, '');
const email = process.env.ATLASSIAN_EMAIL || process.env.FORGE_EMAIL;
const token = process.env.ATLASSIAN_API_TOKEN || process.env.FORGE_API_TOKEN;
if (!site || !email || !token) {
  console.error('Set ATLASSIAN_SITE, ATLASSIAN_EMAIL (or FORGE_EMAIL) and ATLASSIAN_API_TOKEN first.');
  process.exit(2);
}
const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

async function call(method, path, body) {
  const res = await fetch(`${site}${path}`, {
    method,
    headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} returned ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const page = PAGES.ssoDecision;
const restore = process.argv.includes('--restore');
const spaces = await call('GET', `/wiki/api/v2/spaces?keys=${SPACE.key}`);
const spaceId = spaces.results[0].id;
const found = await call('GET', `/wiki/api/v2/spaces/${spaceId}/pages?${new URLSearchParams({ title: page.title })}`);
const current = await call('GET', `/wiki/api/v2/pages/${found.results[0].id}`);
const next = current.version.number + 1;
await call('PUT', `/wiki/api/v2/pages/${current.id}`, {
  id: current.id,
  status: 'current',
  title: page.title,
  body: { representation: 'storage', value: restore ? page.body : page.editedBody },
  version: { number: next, message: restore ? 'Fixture: restore the approval' : 'Fixture: defer the decision' },
});
console.log(`Page ${current.id} "${page.title}" is now version ${next} (${restore ? 'restored' : 'edited'}).`);
