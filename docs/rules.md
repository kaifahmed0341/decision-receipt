# The rule set and its limits

Decision receipt decides what a linked page says about a task with fixed text rules. There is no model. This page states the rules, what they get right and wrong on a labelled set, and where they fail.

The code is [`src/lib/classify.js`](../src/lib/classify.js).

## From page to sentences

1. The page body is read in Confluence storage format and turned into plain text. Block tags (paragraphs, headings, list items, table cells) become line breaks. Macro parameters are dropped; macro bodies are kept.
2. Each line is split into sentences after `.`, `!` or `?` when the next word starts with a capital letter, a digit or a quote. A heading or list item stays one unit.
3. Excerpts are these sentences, unchanged. Sentences longer than 400 characters are cut and marked as cut.

## Rules for one sentence

A sentence is **relevant** to the task when any of these holds:

- it names the issue key as a whole key (`DREC-1` matches, `DREC-12` does not);
- it is a status line, starting with `Status:`;
- it contains at least 60 percent of the significant words of the issue summary, and at least two. Significant words have three or more characters, are not on a short stopword list and are not bare numbers. Words are lower-cased and a trailing plural `s` is dropped on both sides, so "PDFs" matches "pdf".

A relevant sentence is then classified, in this order:

1. Ends with `?`: **mention**. A question is not a decision.
2. Contains a blocking phrase: **conflict**. The phrases are "will not", "won't", "shall not", "must not", "do not", "don't", "should not", "not approved/accepted/agreed/...", "rejected", "declined", "decided against", "deferred", "postponed", "on hold", "superseded", "reversed", "withdrawn", "cancelled", "no longer", "out of scope", "blocked".
3. Contains a supporting phrase: **support**, unless "not", "never", "no" or a negative contraction comes within three words before it, which makes it a **conflict**. The phrases are "approved", "accepted", "agreed", "decided to", "Decision: go/yes/proceed/approved/accepted", "go ahead", "signed off", "confirmed", "will proceed", "in scope", "Status: decided/done/approved/accepted".
4. Otherwise: **mention**.

## Rules for a page and an issue

- A page **conflicts** if any relevant sentence conflicts, even when others support.
- A page **supports** if at least one sentence supports and none conflicts.
- Otherwise the page is **missing** the decision.
- Across linked pages: any conflict gives **Unresolved conflict**. **Evidence found on every linked page** needs every page to be read and to support. Some support with gaps gives **Evidence incomplete**. Pages read with no support give **Missing evidence**. No page read gives **Could not check**.

The panel never says a task is approved.

## Measured on a labelled set

[`fixtures/labelled-excerpts.json`](../fixtures/labelled-excerpts.json) holds 32 fictional sentences for five fixture tasks, each labelled by hand as support, conflict, mention or irrelevant. The labels were written before the first run and were not changed afterwards. The same person wrote the rules and the labels, so this set shows known weaknesses; it is not an independent benchmark.

Run it with `npm run evaluate`. Result on 16 November 2026:

| | Count |
|---|---|
| Excerpts | 32 |
| Correct | 24 (75.0 percent) |
| Conflicts the rules called support | 1 |
| Supports the rules called conflict | 2 |

| Human label | Labelled | Rules predicted | Correct |
|---|---|---|---|
| support | 12 | 8 | 7 |
| conflict | 11 | 11 | 9 |
| mention | 5 | 8 | 4 |
| irrelevant | 4 | 5 | 4 |

Confusion, rows are the human label, columns the rule output:

| | support | conflict | mention | irrelevant |
|---|---|---|---|---|
| support | 7 | 2 | 3 | 0 |
| conflict | 1 | 9 | 1 | 0 |
| mention | 0 | 0 | 4 | 1 |
| irrelevant | 0 | 0 | 0 | 4 |

## Known limits, with the misses that show them

- **The direction of a decision is not understood.** "We decided to keep the v1 CSV export endpoint for another year" is a conflict for a task to remove it, but "decided to" reads as support. This is the most dangerous miss, because it can make a conflicting page look supportive. The panel shows the sentence and the phrase it matched, so a reader can catch it, and the panel never claims approval.
- **Negation of the opposite proposal reads as a conflict.** "The proposal to keep the endpoint was rejected, so removal goes ahead" and "We will not do anything else before the admin console switches" both support the task but contain blocking phrases.
- **Plain future statements carry no decision phrase.** "Invoice PDFs switch to the new renderer in release 4.2" and "The admin console will use single sign-on from 4.3" read as mentions, so a page written this way shows as missing evidence rather than support. That errs on the safe side.
- **A stated status quo is not seen as a conflict.** "The rate limit stays at 300 requests per minute" is a mention.
- **Word forms are not matched.** "raising" does not match "raise", so a sentence can fall below the 60 percent threshold.
- **Long summaries make relevance strict.** The 60 percent rule needs more matching words as the summary grows.
- **Sentence splitting is simple.** "Decision: go. Raise the limit..." becomes two sentences on a real page, and only the second is relevant. Abbreviations followed by a capital letter can also split a sentence.
- **Only text is read.** Decision macros, task lists, page properties, images and attachments are not interpreted beyond their text.

## Why rules and not a model

The accepted plan rules out paid outside inference for the first slices. Fixed rules also make each verdict explainable next to the excerpt, and they never invent text. Every miss above shows its matched phrase in the panel, so the reviewer can check the rule's work.
