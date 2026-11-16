# How a page is read, and how well it works

Decision receipt decides what a linked page says about a task with fixed rules, not a model. Since rules version 4 the rules are **conservative**: they say "supports" or "conflicts" only on strong evidence, and leave everything else to the reader as **"decision unclear"**, with the excerpts shown. This page states the contract, the rules, the measured precision, recall and abstention on two blind sets written by outside reviewers, and the limits.

Code: [`src/lib/storage.js`](../src/lib/storage.js) reads the page, [`src/lib/direction.js`](../src/lib/direction.js) finds which way a sentence points, [`src/lib/classify.js`](../src/lib/classify.js) applies the rules (`RULES_VERSION` 5). A recorded check made under another rules version is reported as stale.

## The contract

A page **supports** or **conflicts with** a task only on one of these:

1. **A structured decision field**: a status lozenge or a "Status" row on a Decision or DACI page; a bare status word (Accepted, Rejected, Superseded, Deprecated, Proposed) under an ADR's "Status" heading; a status column in a decision log; a decision item marked decided. The field must be tied to the task: its scope names the issue key, or the decided statement names the task's own action. A decided status whose direction is unknown is "decision unclear".
2. **An explicit decision sentence**: a clear decision phrase (approved, agreed, decided to, rejected, decided not to, superseded, rolled back, parked, cannot...) in a clause that names the issue key or the task's own action, with the direction resolved. Approving the opposite of the task ("agreed to keep the endpoint" for a removal task) is a conflict. A partial approval of the task ("for staff accounts only", "with exception", "as a first step") is a conflict.

Everything else that is about the task is **decision unclear**: plans and dates without a decision phrase, statements of the current state, hedged or conditional approvals, approvals for a different amount, approvals that do not say for what, refusals of the opposite, double negatives, questions, opinions. The panel shows these excerpts and says so; it does not guess.

Headlines: **Unresolved conflict** if any page conflicts; **Evidence found on every linked page** only when every link was read and every page supports on strong evidence; **Decision unclear, read the excerpts** when a page has excerpts but no strong evidence; **Evidence incomplete** when some pages support and others say nothing or could not be read; **Missing evidence**, **Could not check**, **No decision pages linked** otherwise. The panel never says a task is approved.

## Reading the page

Confluence's storage format is turned into units a reader sees as one thing: paragraphs and list items (split into sentences), headings, table rows (cells joined with " | "), tasks with their done state, decision items with their state, status lozenges as values, Jira issue macros as their key, and the titles of expand and panel macros. What a reader cannot see is dropped: editor placeholders, struck-out and deleted text, hidden macros, macro parameters, the fallback copy of native decision items, and text styled white, transparent, hidden, zero-size or zero-opacity. Samples Confluence produced are in [`test/storage-samples`](../test/storage-samples).

Status statements count only for their own scope: their table, their headed section, the whole page for an ADR "Status" section, and on a page with no headings the paragraph just before them. A scope that names another issue key instead of this one is ignored; one that names both is "unclear". Names of standards (ISO-8601, AES-256, SHA-256, RFC-...) are not taken for issue keys.

Links Jira adds by itself when a page mentions an issue ("mentioned in") are not decision links: they are counted in a note and not read as evidence.

## Measured

Labels: support, conflict, mention (about the task, no decision), irrelevant. A "decision unclear" result counts as mention. **Abstention** is the share of items a reader labelled support or conflict that the rules left undecided.

### Rules version 4, frozen, each set run once

| Set | Items | Conflicts read as support | Support precision / recall | Conflict precision / recall | Abstention |
|---|---|---|---|---|---|
| Review 2, 68 pages in other writing styles ([run](eval/heldout-review-2.txt)) | 68 | **0** | 1.00 / 0.36 | 0.88 / 0.32 | 64% (30 of 47) |
| Review 1, 75 sentences ([run](eval/heldout-review-1-v4.txt)) | 75 | **0** | 0.92 / 0.46 | 0.88 / 0.58 | 46% (23 of 50) |

### Rules version 5, after two post-hoc fixes

The three wrong conflict calls above were read, and two fixes were added that can only turn a decision into "unclear": a reversal of a rollback or rejection, and a refusal followed in the same sentence by a commitment to the task. These numbers are therefore not blind.

| Set | Conflicts read as support | Support precision / recall | Conflict precision / recall | Abstention |
|---|---|---|---|---|
| Review 2 ([run](eval/posthoc-review-2-v5.txt)) | 0 | 1.00 / 0.36 | 1.00 / 0.32 | 66% (31 of 47) |
| Review 1 ([run](eval/posthoc-review-1-v5.txt)) | 0 | 0.92 / 0.46 | 0.94 / 0.58 | 48% (24 of 50) |
| Development set, 94 sentences, tuned on ([run](eval/dev-set.txt)) | 0 | 1.00 / 0.47 | 0.96 / 0.68 | 41% (26 of 64) |

### What this means

- When the panel says "supports" or "conflicts", it is right about nine times in ten or better on both outside sets, and it did not once call a conflict support.
- It says "decision unclear" for roughly half to two thirds of the pages a careful reader could decide. Free prose that decides without a clear decision phrase ("nightly backups -> object storage", "the limit stays at 500 MB", "will be retired on 15 April") lands there. That is the price of the precision, and the panel says so in its headline instead of guessing.
- How blind each set was: review 1's set had been run before (45 of 75 on the slice 2 rules, and 65 of 75 on rules version 3, which were shaped on phrases that review quoted); review 2's items were not opened before the frozen run, but its findings quote parts of about a dozen of them and some rule additions in version 4 (exception, first step, rolled ... back, parked, cannot, ADR status sections) answer those findings.
- Review 2 measured the previous, looser rules (version 3) on its set at 39 of 68, with 5 conflicts read as support. That result is why the rules became conservative.

## Known limits

- **Recall is low by design.** Decisions written as plans, dates, arrows or bare statements are "unclear". The reader sees the excerpts.
- **Direction needs a known verb.** A task whose summary starts with a verb outside the action lists (fix, translate, investigate, document) has no direction, so only key-naming sentences and fields can decide it.
- **A page's history counts.** A page that rejected a task in March and approved it in November is a conflict: any conflict on a page wins. That errs on the safe side.
- **Consequences can read as reversals.** "Customers can no longer log in after the drop" reads "no longer" as a reversal.
- **Relevance uses words.** A sentence must name the issue key, use 60 percent of the summary's words, or name the task's whole subject with a decision phrase. A decision section on a page whose title is about the task is read too.
- **Only text and the fields above are read.** Images, attachments, page properties reports and comments are not.

## Why rules and not a model

Rules make each verdict explainable next to its excerpt and never invent text, and conservative rules make a decided verdict trustworthy. The Rovo agent reports the same receipt and is told it may not change or second-guess a label; it adds no reading of its own.
