# Decision receipt

**A receipt, not a reviewer.** Decision receipt is a Forge app for Jira. On any issue it shows what the Confluence decision pages linked to that issue actually say about it: the exact sentence, the page version, when it was read, and whether it supports the work, conflicts with it, or decides nothing. It never says the work is approved.

Built for [Codegeist 2026](https://codegeist2026.devpost.com/), category Apps for Software Teams. For the engineer or lead who has to show why a change was allowed to start.

![DREC-2: one page agrees, another says "will not"](docs/proof/drec-2-conflict.png)

## Three things it shows

**1. You never see a page you cannot open.** Every read runs as the viewer (`api.asUser()`). A linked page the viewer may not open shows as "Not available to you", with no title, no link, no excerpt and no page id, and the Rovo agent can only call it "linked page 3". Proven on a live site with two accounts: the reviewer saw "Evidence incomplete" and nothing of the restricted page anywhere in the issue, while the page owner saw "Unresolved conflict" with the page quoted. [Reviewer](docs/proof/drec-6-reviewer-restricted.png), [owner](docs/proof/drec-6-owner-control.png), [Confluence refusing the reviewer](docs/proof/drec-6-reviewer-confluence-locked.png), [text check of both pages](docs/proof/drec-6-permission-check.json).

**2. Each reviewer's check is theirs, and it goes stale.** A reviewer can record a check after reading the evidence. The record is kept for that person only and holds no page text. When a linked page is edited, a link is added or removed, a page becomes unreadable, the issue summary is reworded or the rules change, the panel says the recorded check is stale, names what changed, and asks for a fresh one. [After a page edit](docs/proof/drec-7-stale-after-edit.png), [after a summary edit](docs/proof/drec-1-stale-after-summary-edit.png), [a recorded conflict, shown in a neutral colour](docs/proof/drec-2-recorded-conflict-neutral.png).

**3. Every verdict carries a verbatim quote, a version and a time, from published rules with a measured error rate.** The verdicts come from fixed rules anyone can read ([docs/rules.md](docs/rules.md)), not a model. They read Confluence's own decision formats (status lozenges, decision items, task lists, decision log tables) and check which way a decision points, so "we agreed to keep the endpoint" conflicts with a task that removes it. On a 75-sentence set written by an outside reviewer the rules scored 65 of 75, with no conflict read as support; the misses are listed. [DACI page](docs/proof/drec-8-decision-template.png), [status per section](docs/proof/drec-9-scoped-status.png), [decision log](docs/proof/drec-10-decision-log.png).

## Ask Rovo

On sites with Rovo, the **Decision receipt** agent answers questions such as "Show the decision receipt for DREC-2" in Rovo chat. It calls three read-only actions that return the same receipt the panel computes, with the same permissions, and it is told to quote exactly, never change a verdict, and put anything of its own under "Rovo's reading (not part of the receipt)". The panel's **Ask Rovo** button opens it on the current issue. The same three actions are exposed as MCP tools (`rovo:mcp`) for custom agents in Rovo Studio and, once a site admin turns it on, outside MCP clients; [skill/SKILL.md](skill/SKILL.md) tells an agent how to use them. The prompt is in [agent/prompt.txt](agent/prompt.txt). No outside model, no key, no extra scope.

## Judge setup

You need an Atlassian Cloud site with **Jira and Confluence** where you are a site admin. The Codegeist demo site works and has Rovo; a free developer site works for everything except the Rovo agent. Expected results are given at each step.

1. **Install.** Open the installation link from the Devpost submission and select **Get app**. Choose your site. Jira is installed automatically; also tick **Confluence** under "Select any additional Atlassian apps", then select **Install**. Expected: "Installation successful" next to both Jira and Confluence. The app needs both to read decision pages.

2. **Load the demo data.** Create an API token at <https://id.atlassian.com/manage-profile/security/api-tokens>. With Node.js 20 or later:

   ```sh
   git clone https://github.com/kaifahmed0341/decision-receipt.git
   cd decision-receipt
   node scripts/fixtures.mjs
   ```

   No `npm install` is needed. The script asks for your site address, your email and the token (hidden, not saved), checks them, then creates a `DREC` project, a `DRDEMO` space, eleven fictional pages and ten issues, printing each one as it goes. Expected last line: "Done. Open https://your-site.atlassian.net/browse/DREC-2 ...". If your site already has a `DREC` project, run it with `FIXTURE_PROJECT_KEY=DRX node scripts/fixtures.mjs`. Running it again changes nothing.

3. **Open the panel.** Open `DREC-2`. Under the summary select **View app actions**, then **Decision receipt**. The panel stays on that issue from then on. Expected: "Unresolved conflict", with "Decision: invoice PDF renderer" quoted as support and "Release review: 4.2 readiness" quoted as a conflict, each with its version and read time. The other issues:

   | Issue | Expected headline | What it shows |
   |---|---|---|
   | DREC-1 | Evidence found on every linked page | a plain approval |
   | DREC-2 | Unresolved conflict | two pages that disagree |
   | DREC-3 | Missing evidence | notes that discuss the task but decide nothing |
   | DREC-4 | Could not check | the linked page is in the trash |
   | DREC-5 | No decision pages linked | nothing linked |
   | DREC-6 | Unresolved conflict for you; Evidence incomplete for anyone else | one page is restricted to the account that ran the script |
   | DREC-7 | Evidence found on every linked page | use it for the stale check below |
   | DREC-8 | Evidence found on every linked page | a DACI page: DECIDED lozenge and a decision item |
   | DREC-9 | Unresolved conflict | meeting notes; only this issue's section (DEFERRED) counts, not another issue's APPROVED |
   | DREC-10 | Evidence found on every linked page | a decision log row with an APPROVED lozenge and a done approval task; a struck-out "rejected" is ignored |

4. **See a check go stale.** On `DREC-7` select **Record this check**. Expected: "Recorded check still matches". Now open the linked page "Decision: admin console sign-in" in Confluence, edit it, change "Approved: the admin console moves to single sign-on in release 4.3" to "Deferred: single sign-on for the admin console waits for release 4.4", and publish. Reopen `DREC-7`. Expected: "Recorded check is stale", naming the page, its old and new version, and that it supported the task before and conflicts now; the headline is "Unresolved conflict".

5. **See the permission boundary.** `DREC-6` links "Legal hold review: audit logs", which the script restricted to your account. Invite any second user as a normal Jira and Confluence user and open `DREC-6` as them (or in a private window). Expected: "Evidence incomplete" and "Linked page 1: Not available to you", with nothing from that page anywhere in the panel; your own account sees "Unresolved conflict" with the page quoted.

6. **Ask Rovo** (sites with Rovo). On `DREC-2` select **Ask Rovo** in the panel, or open Rovo chat and choose the **Decision receipt** agent. Expected: the overall result, each page with its label, version and read time, the deciding quotes word for word, and, if it adds anything, a separate "Rovo's reading (not part of the receipt)". [Screenshot from the demo site](docs/proof/rovo-agent-drec-2.png).

7. **MCP tools** (optional). In Rovo Studio, create a custom agent and add the Decision receipt tools. For outside MCP clients a site admin turns the tools on under Administration, Apps, Sites, your site, Connected apps; the endpoint is `https://mcp.atlassian.com/forge/a6c7992f-da45-443e-ab7f-88cbffdd967b`.

Steps 1 to 4 were walked on 16 November 2026 on a second site created and administered by a different account from the app owner's: installed from the sharing link, demo data loaded with that account's own token, all ten issues showed the expected headline, and DREC-7 went stale after its page was edited ([log](docs/proof/second-site-walk.txt)). Step 5 was shown on the author's development site with two accounts (screenshots linked above), and step 6 on the Codegeist demo site.

## What it does not do

- It writes nothing to Jira or Confluence: no comments, no transitions. The only thing it stores is each reviewer's own recorded check.
- It reads only pages linked to the issue. It does not search Confluence or use Teamwork Graph.
- Its rules still miss some phrasings. The measured misses and limits are in [docs/rules.md](docs/rules.md).
- It does not use Forge LLMs or any outside model. Rovo, when used, runs on the customer's own site.

## Permission model and data

- Scopes: `read:jira-work` (issue summary, history and remote links), `read:page:confluence` (page body and version), `storage:app` (recorded checks). No write scopes, no outside network access.
- When a page cannot be read, Confluence answers 404 (or 403) whether it was deleted or the viewer lacks permission. The app does not try to tell these apart and shows neither the page's title nor the Jira link's title or URL, since a URL can carry a title.
- A recorded check is keyed by site, issue and account, and holds page ids, read status, versions, results and a hash of the summary. One reviewer's record is never read for another. Details: [PRIVACY.md](PRIVACY.md).
- The page link in the panel is built from the page Confluence returned, never from the Jira link's own URL; links with no proper host, or whose page id disagrees with their address, are not trusted.
- Jira is the app's required product and Confluence optional (`app.compatibility`), which is how an app placed in Jira reads Confluence on the same site.

## Acceptance cases

| Case | Result on a live site | Proof | Unit tests |
|---|---|---|---|
| A linked page states the decision clearly | Excerpt, link and page version shown | [DREC-1](docs/proof/drec-1-supported.png) | `fixtures.test.mjs` |
| Two accessible sources conflict | Both pages shown, "Unresolved conflict" | [DREC-2](docs/proof/drec-2-conflict.png) | `fixtures.test.mjs`, `classify.test.mjs` |
| The linked page omits the decision | "Missing evidence" | [DREC-3](docs/proof/drec-3-missing.png) | `fixtures.test.mjs` |
| The linked page is deleted | "Deleted or archived", nothing quoted | [DREC-4](docs/proof/drec-4-deleted-page.png) | `receipt.test.mjs` |
| User A can read a source, user B cannot | B sees no title, text or link; A sees the page | [DREC-6](docs/proof/drec-6-reviewer-restricted.png) and control | `receipt.test.mjs`, `fixtures.test.mjs`, `agent.test.mjs` |
| The page changes after a check | Recorded check stale until a fresh one is recorded | [stale](docs/proof/drec-7-stale-after-edit.png), [fresh](docs/proof/drec-7-fresh-check-recorded.png) | `staleness.test.mjs` |
| The task is reworded after a check | Stale, naming the summary change and the changed result | [DREC-1](docs/proof/drec-1-stale-after-summary-edit.png) | `staleness.test.mjs` |
| Confluence's own decision formats | DECIDED lozenge, decision item, decision log row read | [DREC-8](docs/proof/drec-8-decision-template.png), [DREC-10](docs/proof/drec-10-decision-log.png) | `storage.test.mjs` |
| A page holds statuses for several issues | Only this issue's section counts | [DREC-9](docs/proof/drec-9-scoped-status.png) | `classify.test.mjs` |
| The Rovo agent | Quotes the receipt, labels its own reading | [DREC-2 in Rovo](docs/proof/rovo-agent-drec-2.png) | `agent.test.mjs` |
| A second, independent site installs the release | Installed from the link; ten of ten expected results | [log](docs/proof/second-site-walk.txt) | |
| Rate limit, interrupted request, time limit | Reported per page; never guessed | not triggerable on demand | `receipt.test.mjs` |

## Developer setup

You need Node.js 22, the Forge CLI and an Atlassian API token.

```sh
npm install -g @forge/cli
git clone https://github.com/kaifahmed0341/decision-receipt.git
cd decision-receipt && npm install
export FORGE_EMAIL=you@example.com FORGE_API_TOKEN=your-token
npm test                       # 90 unit tests, no network
forge register decision-receipt   # your own copy; replaces app.id
forge deploy -e development
forge install -e development -p jira -s your-site.atlassian.net
forge install -e development -p confluence -s your-site.atlassian.net
npm run fixtures               # same as node scripts/fixtures.mjs
npm run evaluate               # score the rules on the development set
```

`npm run edit-page` (and `-- --restore`) edits DREC-7's page from the command line for the stale demo. If a deploy that adds a scope asks to approve a major version, rerun with `--approve MAJOR_VERSION_RULE` and then `forge install --upgrade` for both products.

## Project layout

```
manifest.yml              panel, Rovo agent, actions, MCP tools, scopes, Jira/Confluence compatibility
agent/prompt.txt          the Rovo agent's instructions
skill/SKILL.md            how an outside agent should use the MCP tools
src/frontend/             the UI Kit panel
src/resolvers/            the panel's backend
src/actions/              the three read-only Rovo actions
src/lib/forge-http.js     every Jira and Confluence call, as the user
src/lib/storage.js        Confluence storage format to sentences, rows, tasks, decisions, statuses
src/lib/direction.js      the task's action, and which way a sentence points
src/lib/classify.js       the rules, status scoping, page and issue verdicts
src/lib/evidence.js       the wording a reviewer reads
src/lib/receipt.js        one check: links, retries, interruptions, time budget
src/lib/staleness.js      recorded checks and what makes them stale
src/lib/review.js         loading and recording a check
src/lib/agent.js          the receipt as the Rovo actions return it
fixtures/                 demo data and the labelled development sets
scripts/                  demo data setup, the stale-demo edit, rule scoring
test/                     unit tests and real Confluence storage samples
docs/rules.md             the rules, measured accuracy and limits
docs/eval/                saved scoring runs
docs/proof/               screenshots and logs from live sites
docs/decisions.md         choices made while building
```

## License

MIT. See [LICENSE](LICENSE). Privacy: [PRIVACY.md](PRIVACY.md). Terms: [TERMS.md](TERMS.md).
