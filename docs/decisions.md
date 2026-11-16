# Decisions

Choices made while building the first slice on 16 November 2026, each with the alternative rejected.

## Environment

- Node.js 22.23.4 runs the Forge CLI 15.1.0. Node 26, the machine default, makes the CLI print "Unsupported Node.js versions". The app runtime is `nodejs24.x`, as the template set it.
- Packages are pinned to the stable `@forge/api` 8.5.0, `@forge/bridge` 7.3.0, `@forge/react` 12.5.0 and `@forge/resolver` 2.0.2. The template pinned prerelease `-next` builds; rejected because a hackathon entry has to stay installable through judging.
- The CLI logs in from `FORGE_EMAIL` and `FORGE_API_TOKEN` in the environment instead of `forge login`, so no token sits in the system keychain.
- A Developer Space named `kaif-ahmed` holds the app. Forge requires one for new apps; the CLI's `--personal` flag was rejected because the docs do not describe it.

## App shape

- UI Kit `jira:issuePanel`, rejected Custom UI: UI Kit covers the panel and keeps the code small.
- Product calls run in the resolver with `api.asUser()`, rejected calling `requestJira` from the frontend: the resolver keeps the rule set in plain Node, testable without a browser, and lets errors such as a consent request pass through untouched.
- Jira is the required product and Confluence is optional in `app.compatibility`. A Jira-only app cannot read Confluence. Note: an app compatible with two products can only be listed on Marketplace as a paid app, which matters only if the Marketplace bonus is pursued later.
- Scopes are `read:jira-work` and `read:page:confluence`. Confluence REST v2 `GET /pages/{id}` gives the body and version in one call.
- Pages are read one at a time with up to two retries on 429 or 503, waiting as `Retry-After` asks, at most 4 seconds per wait. Rejected parallel reads, which would trip rate limits sooner on issues with many links.
- At most 10 linked pages are checked per issue, to stay inside the resolver's time limit.
- A 403 and a 404 both show "Not available to you" with no title, link or text. Confluence uses 404 for both deleted and forbidden pages; telling them apart would leak that a page exists.
- Links whose host differs from the current site are never fetched: the page id would be looked up on this site and could name a different page. When the site host is unknown, every absolute link is treated as another site.

## Rule set

- Fixed phrase lists and summary-word overlap, no model, as the accepted plan requires. Rejected fuzzy scoring: a reviewer has to be able to see why each verdict happened, so every excerpt shows its matched phrase.
- A conflict anywhere wins over support anywhere, and full support needs every linked page to be read. Rejected majority voting, which would hide the conflict the app exists to show.
- Labels never say "approved". The full-support message says the panel does not approve work, and a test checks the wording.

## Fixtures

- Links are Jira remote links with application type `com.atlassian.confluence`, created through REST. That is the shape Jira's own "Link Confluence page" action produces, and Jira recognised them as native links. Rejected the Confluence page "Jira issue" macro, which links the other way and is harder to read as the viewer.
- The deleted-page case uses a page moved to the trash. As the page owner, Confluence answers 200 with status `trashed`, so the panel shows "Deleted or archived". A viewer without access gets 404 and sees "Not available to you"; slice 2 proved the 404 path live with a second user and a restricted page (DREC-6).
- Fixture text lives in `fixtures/data.mjs` and the tests run the full receipt over it, so the expected verdicts are checked on every test run.

## Repository

- `kaifahmed0341/decision-receipt`, public, MIT, at Kaif's request in place of `sami-abdul/decision-receipt` from the plan.
- The template's `AGENTS.md` was removed. It held generic agent instructions unrelated to this app.
- Dalil was not reused in this slice, so its license was not checked. Nothing from it is in this repository.

# Slice 2, 16 November 2026

## Second user

- The reviewer account is `kaifahmed0341+reviewer@gmail.com`, display name "Demo Reviewer", invited from Administration as a plain user with the `jira-users` and `confluence-users` groups and no admin role. Its password was generated with `openssl rand` and lives outside the repository. Rejected a guest account: the plan's case is an ordinary licensed user who lacks access to one page, not a guest.
- The invitation, the sign-up code and the sign-up form ran in a Chrome incognito window so Kaif's own session stayed signed in. No CAPTCHA appeared.
- The restricted page is a new fixture page, not an edit of an existing one, so DREC-1 to DREC-5 keep their slice 1 behaviour. Its Jira link carries the neutral title "Confluence page", because a link title is visible to everyone who can see the issue.

## Recorded checks and stale detection

- A check is recorded only when the reviewer selects **Record this check**. Rejected recording every check automatically: the stale warning would vanish on the next open, which defeats "require a fresh check".
- Records are per site, issue and user. Rejected one shared record per issue: it would let one reviewer's record carry page ids, versions and verdicts for pages another reviewer cannot open.
- A record stores page id, read status, version and verdict only. Excerpts are not stored; the panel always shows a live read.
- Recording reads the pages again on the server and refuses if their state differs from what the panel showed (compared by a hash), or if any page was rate limited, interrupted or skipped for time. Pages the viewer cannot open and deleted pages may be recorded as such, because that is a stable state.
- Records use `@forge/kvs` 2.1.2, the current key-value package, with the `storage:app` scope. Adding the scope forced a major version on the development environment (`--approve MAJOR_VERSION_RULE`) and an install upgrade in both products.

## Failure handling

- An exception from a page request, other than the platform's consent error, is shown as "Request interrupted" for that page. Rejected failing the whole panel: one bad page should not hide the evidence from the others.
- No new page read starts after 18 seconds; later pages show "Not read". Forge resolvers stop at about 25 seconds, and a cut-off panel would show nothing.
- Rate limits and interruptions are tested with faked responses only. Triggering a real rate limit on a shared developer site would affect other work on it.

## Measuring the rules

- 32 hand-labelled fictional sentences, labelled before the first run and not changed after it. Result 24 of 32. Rejected tuning the rules against this set in the same slice: the numbers would stop meaning anything. Any rule change in a later slice should come with new sentences it has not seen.

## Fixture state

- DREC-7's page was edited to version 2 for the stale proof and then restored with `edit-page --restore`, so it now sits at version 3 with the original approval. Kaif's recorded check on DREC-7 is therefore stale again, which is the expected behaviour.
