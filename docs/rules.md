# How a page is read, and how well it works

Decision receipt decides what a linked page says about a task with fixed rules. There is no model. This page states how a page is read, the rules, what they get right and wrong on two labelled sets, and where they fail.

Code: [`src/lib/storage.js`](../src/lib/storage.js) reads the page, [`src/lib/direction.js`](../src/lib/direction.js) finds which way a sentence points, [`src/lib/classify.js`](../src/lib/classify.js) applies the rules. The rules carry a version number (`RULES_VERSION`, now 3); a recorded check made under another version is reported as stale.

## Reading the page

Confluence stores pages in an XML-like storage format. The parser turns it into units a reader sees as one thing:

- **Paragraphs, list items, headings**: split into sentences. A short label such as "Decision: go." stays with the sentence after it, and common abbreviations do not split.
- **Table rows**: one unit, cells joined with " | ". A table's header row names its columns, so a "Status" column is read as the row's status.
- **Tasks**: the task text with its done state (`complete` or `incomplete`).
- **Decision items** (Confluence's native decisions): the text with its state (`DECIDED`).
- **Status lozenges**: their label is read as a value. A cell offering several lozenges, as an unfilled template does ("Not started / In progress / Complete"), decides nothing.
- **Jira issue macros**: read as the issue key they show.

Dropped, because a reader does not see them in view mode: editor placeholders, struck-out and deleted text, macros marked hidden, macro parameters, the fallback copy Confluence stores beside native decision items, and code, navigation and include macros.

The shapes were taken from pages Confluence produced on the test site and from its own DACI, Design decision and Decision log templates. Samples are in [`test/storage-samples`](../test/storage-samples).

## Which units are about the task

A sentence or unit is about the task when:

1. it names the issue key, or a key the issue had before it moved (from the issue's change history); or
2. it contains at least 60 percent of the significant words of the summary, and never fewer than two. Words are compared by a light stem, so "retire", "retiring" and "retirement" match; or
3. it names the task's whole subject, the words after the summary's verb up to the first preposition ("the status page" in "Move the status page to a managed provider"), **and** carries a decision signal. Without a signal such a sentence is ignored.

**Status lines are scoped.** "Status: Approved", a "Status | DECIDED" row or an "Outcome" line applies only to its own scope: the table it sits in, or the section under its heading (with the page title for the first section). It counts only when that scope is about the task. If the scope names another issue key and not this one, the status is ignored. If it names both, the status is a mention.

## Which way a sentence points

The task's action comes from the first verb of its summary: remove (retire, drop, archive...), keep (stay, remain, retain...), enable (add, adopt, ship, turn on...), disable (turn off...), increase (raise, extend...), decrease (lower, reduce...) or change (move, migrate, switch, upgrade...). Each action has opposites: keeping things as they are opposes every change, lowering opposes raising, and so on.

## Rules for one sentence or unit

1. Ends with "?": **mention**.
2. Says no decision exists ("nothing was agreed", "no decision", "nobody has decided"): **mention**.
3. States an opinion ("we don't think", "I believe"): **mention**.
4. Find the decision phrases and keep the **last** one:
   - supporting: "approved", "agreed", "decided to", "confirmed", "go ahead", "green light", "signed off", "mandatory", "Decision:" or "Agreed:" as a label, ": yes" at the end;
   - blocking: "will not", "never", "rejected", "decided not to", "chose not to", "deferred", "on hold", "blocked", "not approved" and similar;
   - reversal: "superseded", "reverted", "rolled back", "replaced by", "overturned", "reversed", "withdrawn", "no longer".
   A supporting phrase with "not", "never" or "no" in the three words before it blocks instead.
5. If the last phrase supports: it is a **conflict** when its clause (or else the sentence) names the opposite of the task ("agreed to keep the endpoint"); a **conflict** when its clause limits it ("for staff accounts only", "first phase", "except"); a **mention** when its clause hedges ("in principle", "pending", "probably", "once", "if"); otherwise **support**.
6. If the last phrase blocks or reverses: **support** when its own clause names the opposite of the task ("the proposal to keep it was rejected"); otherwise **conflict**.
7. With no decision phrase: **conflict** if the sentence states the opposite of the task ("the limit stays at 500 MB"); **mention** if it hedges; **support** if it states the task's own action as planned or done ("will be retired on 15 April", "was moved") or carries a date or release ("from 1 February", "in release 4.2"); for a task that keeps something, stating that it stays is support. Otherwise **mention**.

For units: a table row with a status value takes that value, turned round if the row decides the opposite of the task. An open task never counts as support. A done task that says "Approve ..." counts as support. A decision item marked decided that states the task is support, and is a conflict if it states the opposite.

## Rules for a page and an issue

- A page **conflicts** if any finding conflicts; **supports** if at least one supports and none conflicts; otherwise the decision is **missing**.
- Across links: any conflict gives **Unresolved conflict**. **Evidence found on every linked page** needs every link to be read and every page to support; a link to another site, a short link, an untrusted link or a link past the tenth keeps it at **Evidence incomplete**. Pages read with no support give **Missing evidence**. Nothing read gives **Could not check**.

The panel never says a task is approved.

## Measured

Two sets, labelled by hand with the same conventions: a partial approval that withholds part of the task, or a block that stops it now, is a conflict; an approval in principle or pending a condition is a mention; a stated plan with a date is support.

### Development set: tuned on, so it flatters

[`fixtures/labelled-excerpts.json`](../fixtures/labelled-excerpts.json) (32 sentences, one relabelled to the shared convention before any change) and [`fixtures/dev-excerpts.json`](../fixtures/dev-excerpts.json) (62 new sentences over eight new tasks, written before any slice 3 rule change). 94 in all. The rules were tuned on this set.

| | Correct | Conflicts read as support |
|---|---|---|
| Slice 2 rules, before tuning | 50 of 94 (53.2 percent) | 8 |
| Slice 3 rules | 92 of 94 (97.9 percent) | 0 |

| Label | Labelled | Predicted | Correct | Precision | Recall |
|---|---|---|---|---|---|
| support | 30 | 30 | 29 | 0.97 | 0.97 |
| conflict | 34 | 35 | 34 | 0.97 | 1.00 |
| mention | 18 | 17 | 17 | 1.00 | 0.94 |
| irrelevant | 12 | 12 | 12 | 1.00 | 1.00 |

Full output: [`docs/eval/dev-set.txt`](eval/dev-set.txt).

### Held-out set: the honest number

The reviewer's 75 sentences over nine tasks, written by someone other than the rule author. The rules were frozen at commit `74155d0`, the set was run once, and nothing was changed after it. Full output: [`docs/eval/heldout-review-1.txt`](eval/heldout-review-1.txt).

| | Correct | Conflicts read as support |
|---|---|---|
| Slice 2 rules (reviewer's run) | 45 of 75 (60.0 percent) | 3 |
| Slice 3 rules | **65 of 75 (86.7 percent)** | **0** |

| Label | Labelled | Predicted | Correct | Precision | Recall |
|---|---|---|---|---|---|
| support | 24 | 22 | 20 | 0.91 | 0.83 |
| conflict | 26 | 28 | 24 | 0.86 | 0.92 |
| mention | 18 | 18 | 15 | 0.83 | 0.83 |
| irrelevant | 7 | 7 | 6 | 0.86 | 0.86 |

Confusion, rows are the reviewer's label, columns the rule output:

| | support | conflict | mention | irrelevant |
|---|---|---|---|---|
| support | 20 | 2 | 2 | 0 |
| conflict | 0 | 24 | 1 | 1 |
| mention | 2 | 1 | 15 | 0 |
| irrelevant | 0 | 1 | 0 | 6 |

**How held out it really was.** The set file itself was not opened before the run, apart from its labelling conventions, its nine task summaries and its first three sentences. But the review that came with it quotes phrases from about fifteen of the 75 sentences in its miss analysis ("agreed to keep", "approved ... reverted", "approved for staging only", "nothing was agreed", "approved in principle, pending", "stays", "remains", "decided not to", "will be retired on", "is mandatory from"), and several rule changes target exactly those phrase types. Read 86.7 percent as an upper bound on what a fresh set would give, not as an independent score. The next measurement should use a set neither the author nor this review has seen.

## Known limits, with the held-out misses that show them

- **Contrast inside one sentence is read clause by clause, not by meaning.** "We rejected REST-only for the partner API and will adopt GraphQL" is support, but "rejected" is the last decisive phrase and its clause also contains the task's own action, so it reads as a conflict. "The earlier rejection of EU storage ... was reversed; uploads go to the EU region from June" is support, but "reversed" is the last decisive phrase and the rules do not see that it reverses a rejection; the task "Store customer uploads..." also has no action verb the rules know, so direction cannot help.
- **A condition reads as a hedge.** "We agreed to retire the cluster once the reports move" is labelled support; "once" makes it a mention. That errs on the safe side.
- **A reason is not a decision.** "Admin accounts already use hardware keys, so two-factor login adds nothing" argues against the task without a decision phrase, so it stays a mention.
- **Leaning is not a hedge word yet.** "We are leaning towards shipping ... in Q2" reads as a dated plan, so support. Words like "leaning towards" or "favour" are missing from the hedges.
- **The object of an approval is not checked unless it is an action.** "The mobile team agreed the colours with design" after naming the issue reads as support.
- **A neighbouring subject can match.** "Dark mode on the web app is rejected" matches a task about dark mode for the mobile app, because the task's subject words, "dark mode", both appear and the sentence carries a decision phrase. It reads as a conflict.
- **Side effects read as reversals.** "Customers on Internet Explorer 11 can no longer log in after the drop" describes a consequence; "no longer" reads as a reversal.
- **A bare status line with a reference is only scoped on a page.** "Superseded: see the 2026 search plan" alone, with no section, is not tied to the task. On a page, under a heading about the task, it would be.
- **Long summaries still make relevance strict.** The 60 percent rule needs more words as the summary grows; the subject rule helps only when the sentence also carries a decision signal.
- **Only text and the fields above are read.** Images, attachments, page properties reports and comments are not.

## Why rules and not a model

The accepted plan rules out paid outside inference so far. Rules also make each verdict explainable next to its excerpt, and they never invent text: the panel shows the sentence and the rule that fired, so the reviewer can check the work. Whether to add a Rovo step on top is a separate decision, not taken in this slice.
