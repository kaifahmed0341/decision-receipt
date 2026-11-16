/**
 * Turns classifier output into the plain-language evidence the panel shows.
 *
 * Everything a reviewer reads is built here, so the wording can be tested without
 * rendering the UI. The wording never says "approved": the panel reports what the
 * linked pages say and leaves the decision to the reviewer.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The longest excerpt shown in full. Longer sentences are cut and marked as cut.
export const MAX_EXCERPT_CHARS = 400;

// The most excerpts shown per page. Conflicts come first, then support, then mentions.
export const MAX_EXCERPTS_PER_PAGE = 5;

/**
 * Formats an ISO timestamp as "16 Nov 2026, 11:20:05 UTC". Returns "unknown time" for bad input.
 * @param {string} iso
 */
export function formatUtc(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return 'unknown time';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes()
  )}:${pad(d.getUTCSeconds())} UTC`;
}

/** Labels and lozenge appearances for each page verdict. */
export const PAGE_VERDICTS = {
  supports: { label: 'Supports the task', appearance: 'success' },
  conflicts: { label: 'Conflicts with the task', appearance: 'removed' },
  unclear: { label: 'Decision unclear', appearance: 'moved' },
  missing: { label: 'Decision not found', appearance: 'default' },
};

/** Labels and lozenge appearances for each page that could not be checked. */
export const PAGE_PROBLEMS = {
  unavailable: {
    label: 'Not available to you',
    appearance: 'default',
    message:
      'This linked page is not available to you. It may have been deleted, or you may not have permission to see it. Nothing from it is shown, and it does not count as evidence.',
  },
  'not-current': {
    label: 'Deleted or archived',
    appearance: 'default',
    message: 'This linked page is in the trash, archived or still a draft, so it does not count as evidence.',
  },
  'rate-limited': {
    label: 'Not checked yet',
    appearance: 'default',
    message: 'Confluence asked us to slow down before this page could be read. Wait a minute, then select Check again.',
  },
  interrupted: {
    label: 'Request interrupted',
    appearance: 'default',
    message: 'The request for this page did not complete, for example because the connection dropped or timed out. Nothing from it is shown. Select Check again.',
  },
  'confluence-missing': {
    label: 'Confluence not connected',
    appearance: 'default',
    message: 'Decision receipt is installed in Jira but not connected to Confluence on this site, so it cannot read decision pages. A site admin can fix this: open the installation link again, choose this site and tick Confluence.',
  },
  'timed-out': {
    label: 'Not read',
    appearance: 'default',
    message: 'The check stopped before reading this page to stay inside the time limit. Select Check again, or link fewer pages.',
  },
  error: {
    label: 'Check failed',
    appearance: 'default',
    message: 'Confluence returned an error for this page. Select Check again; if it keeps failing, open the page directly.',
  },
};

/** Headlines for the whole issue. None of them claims approval. */
export const OVERALL = {
  'no-links': {
    label: 'No decision pages linked',
    appearance: 'default',
    detail: 'Link the Confluence pages that hold the decisions for this task, then select Check again.',
  },
  conflict: {
    label: 'Unresolved conflict',
    appearance: 'removed',
    detail: 'At least one linked page says something that conflicts with this task. Resolve it with the page owners before relying on the task.',
  },
  'all-support': {
    label: 'Evidence found on every linked page',
    appearance: 'success',
    detail: 'Every link was read, and each linked page records a clear decision for this task: a decided status or an explicit decision sentence. Read the excerpts; this panel does not approve work.',
  },
  unclear: {
    label: 'Decision unclear, read the excerpts',
    appearance: 'moved',
    detail: 'The linked pages discuss this task, but the rules found no clear decision field or decision sentence they trust. The excerpts are below; decide for yourself.',
  },
  incomplete: {
    label: 'Evidence incomplete',
    appearance: 'moved',
    detail: 'Some linked pages record a clear decision for this task, but others state no decision, could not be read, or were not checked.',
  },
  missing: {
    label: 'Missing evidence',
    appearance: 'moved',
    detail: 'None of the linked pages says anything the rules could tie to this task.',
  },
  unchecked: {
    label: 'Could not check',
    appearance: 'default',
    detail: 'None of the linked pages could be read. See each page below for the reason.',
  },
};

const KIND_LABELS = {
  conflict: 'Conflicts',
  support: 'Supports',
  mention: 'About the task, no clear decision',
};

const KIND_ORDER = { conflict: 0, support: 1, mention: 2 };

/**
 * Explains in plain words why a sentence was picked and how it was classified.
 * @param {{reason: string, matchedTerms: string[], cue: string|null, kind: string}} finding
 * @param {string} issueKey
 */
export function explainFinding(finding, issueKey) {
  const where = {
    row: 'Table row',
    task: 'Task',
    decision: 'Decision item',
  }[finding.unitKind];
  let why;
  if (finding.reason === 'key') why = `Names ${issueKey}`;
  else if (finding.reason === 'status') why = finding.section ? `Status for the section "${finding.section}"` : 'Status for this page';
  else if (finding.reason === 'object') why = `Names the task's subject (${finding.matchedTerms.join(', ')})`;
  else if (finding.reason === 'section') why = finding.section ? `In the "${finding.section}" section of a page about this task` : 'On a page about this task';
  else why = `Uses the summary words ${finding.matchedTerms.join(', ')}`;
  if (where) why = `${where}. ${why}`;
  if (finding.cue === 'question') return `${why}. Asked as a question, so not a decision.`;
  if (finding.cue) return `${why}. Rule: ${finding.cue}.`;
  return `${why}. No decision phrase.`;
}

/**
 * Cuts an excerpt to MAX_EXCERPT_CHARS without changing the words that remain. When the
 * sentence is too long, the window is centred on the phrase that decided it, so the
 * reader always sees that phrase.
 * @param {string} sentence
 * @param {string|null} [cue] the finding's cue; its first quoted phrase is looked for
 * @returns {{text: string, truncated: boolean}}
 */
export function excerptOf(sentence, cue = null, cueIndex = null) {
  if (sentence.length <= MAX_EXCERPT_CHARS) return { text: sentence, truncated: false };
  const phrase = cue ? (cue.match(/"([^"]+)"/) || [null, cue])[1] : null;
  // Prefer the exact position the rule matched; search the text only as a fallback.
  const at = Number.isInteger(cueIndex) ? cueIndex : phrase ? sentence.toLowerCase().indexOf(phrase.toLowerCase()) : -1;
  const len = phrase ? phrase.length : 20;
  let start = 0;
  if (at >= 0) start = Math.max(0, Math.min(sentence.length - MAX_EXCERPT_CHARS, at - Math.floor((MAX_EXCERPT_CHARS - len) / 2)));
  const end = start + MAX_EXCERPT_CHARS;
  const text = `${start > 0 ? '...' : ''}${sentence.slice(start, end).trim()}${end < sentence.length ? '...' : ''}`;
  return { text, truncated: true };
}

/**
 * Builds the evidence block for a page that was read successfully.
 *
 * @param {object} args
 * @param {{key: string}} args.issue
 * @param {{pageId: string, url: string}} args.link
 * @param {{title: string, version: number, editedAt: string}} args.page
 * @param {string} args.retrievedAt ISO time the page body was received
 * @param {{verdict: string, findings: Array}} args.result classifier output
 */
export function okPageEvidence({ issue, link, page, retrievedAt, result }) {
  const verdict = PAGE_VERDICTS[result.verdict];
  const sorted = [...result.findings].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const excerpts = sorted.slice(0, MAX_EXCERPTS_PER_PAGE).map((f) => {
    const { text, truncated } = excerptOf(f.sentence, f.cue, f.cueIndex);
    return { text, truncated, kind: f.kind, kindLabel: KIND_LABELS[f.kind], why: explainFinding(f, issue.key) };
  });
  return {
    status: 'ok',
    pageId: link.pageId,
    url: link.url,
    title: page.title,
    version: page.version,
    editedAt: page.editedAt,
    retrievedAt,
    provenance: `Version ${page.version}, last edited ${formatUtc(page.editedAt)}. Retrieved ${formatUtc(retrievedAt)}.`,
    verdict: result.verdict,
    verdictLabel: verdict.label,
    verdictAppearance: verdict.appearance,
    excerpts,
    hiddenExcerpts: Math.max(0, sorted.length - excerpts.length),
    emptyNote:
      result.findings.length === 0
        ? `Nothing on this page names ${issue.key} or matches enough of the summary words.`
        : null,
  };
}

/**
 * Builds the block for a page that could not be checked. It carries no title, URL or
 * page id, so a reviewer without access learns nothing about the page.
 * @param {'unavailable'|'not-current'|'rate-limited'|'interrupted'|'timed-out'|'error'} status
 * @param {string} retrievedAt
 */
export function problemPageEvidence(status, retrievedAt) {
  const problem = PAGE_PROBLEMS[status] || PAGE_PROBLEMS.error;
  return {
    status,
    verdictLabel: problem.label,
    verdictAppearance: problem.appearance,
    message: problem.message,
    provenance: `Tried ${formatUtc(retrievedAt)}.`,
    excerpts: [],
  };
}

/**
 * Plain notes about links that were not checked at all.
 * @param {{otherSite: number, unreadable: number, skipped: number}} counts
 * @returns {string[]}
 */
export function linkNotes({ otherSite, unreadable, skipped, mentionedIn = 0 }) {
  const notes = [];
  const plural = (n, one, many) => (n === 1 ? one : many);
  if (otherSite) notes.push(`${otherSite} ${plural(otherSite, 'link points', 'links point')} to another site and ${plural(otherSite, 'was', 'were')} not checked.`);
  if (unreadable) notes.push(`${unreadable} Confluence ${plural(unreadable, 'link was', 'links were')} not checked: a short link, a link without a proper address, or a link whose page id and address disagree. Link the full page instead.`);
  if (mentionedIn) notes.push(`${mentionedIn} Confluence ${plural(mentionedIn, 'page only mentions', 'pages only mention')} this issue. Mentions are not decision links, so ${plural(mentionedIn, 'it was', 'they were')} not read as evidence. Link a decision page with Link Confluence page.`);
  if (skipped) notes.push(`${skipped} more linked ${plural(skipped, 'page was', 'pages were')} not checked. The panel checks the first 10 pages.`);
  return notes;
}
