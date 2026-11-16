/**
 * The deterministic rule set that decides what a linked page says about a task.
 *
 * No model is involved. Every verdict comes from the rules below, and the panel
 * shows the sentence each verdict came from, so a reviewer can check the rule's work.
 *
 * Rules, in order:
 *  1. A sentence is RELEVANT to the task when it names the issue key (for example
 *     "DREC-2"), when it is a page status line ("Status: Deferred"), or when it
 *     contains at least 60 percent of the significant words in the issue summary
 *     (and at least two of them).
 *  2. A relevant sentence that ends in a question mark is a question, not a decision.
 *     It counts as a MENTION.
 *  3. A relevant sentence with a blocking phrase ("will not", "rejected",
 *     "deferred", "superseded" and the rest of BLOCK_PATTERNS) is a CONFLICT.
 *  4. A relevant sentence with a supporting phrase ("approved", "agreed", "decided
 *     to" and the rest of SUPPORT_PATTERNS) is SUPPORT, unless a negation such as
 *     "not" or "never" comes within three words before it, which makes it a CONFLICT.
 *  5. Any other relevant sentence is a MENTION.
 *
 * Page verdicts:
 *  - "conflicts" when any sentence is a CONFLICT, even if others support the task.
 *  - "supports" when at least one sentence is SUPPORT and none is a CONFLICT.
 *  - "missing" when no sentence is relevant, or relevant sentences are only MENTIONS.
 *
 * Nothing here ever reports approval. "supports" means "this page contains a sentence
 * that supports the task"; the reviewer decides what that is worth.
 */

// Short words and filler that carry no meaning about the task.
const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'also', 'and', 'any', 'are', 'because', 'been',
  'before', 'being', 'below', 'between', 'both', 'but', 'can', 'could', 'did', 'does', 'doing',
  'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having',
  'here', 'how', 'into', 'its', 'just', 'more', 'most', 'must', 'new', 'not', 'now', 'off',
  'once', 'only', 'other', 'our', 'out', 'over', 'own', 'same', 'should', 'some', 'such',
  'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'too', 'under', 'until', 'very', 'was', 'were', 'what', 'when', 'where', 'which',
  'while', 'who', 'why', 'will', 'with', 'would', 'you', 'your', 'task', 'issue', 'story', 'ticket',
]);

// Phrases that block or contradict the task. Checked before the supporting phrases.
export const BLOCK_PATTERNS = [
  /\bwill not\b/i,
  /\bwon['’]t\b/i,
  /\bshall not\b/i,
  /\bmust not\b/i,
  /\bdo not\b/i,
  /\bdon['’]t\b/i,
  /\bshould not\b/i,
  /\bnot (?:be |going to )?(?:approved|accepted|agreed|proceed|go ahead|ship|release|happen)/i,
  /\brejected\b/i,
  /\bdeclined\b/i,
  /\bdecided against\b/i,
  /\bdeferred\b/i,
  /\bpostponed\b/i,
  /\bon hold\b/i,
  /\bsuperseded\b/i,
  /\breversed\b/i,
  /\bwithdrawn\b/i,
  /\bcancel(?:l)?ed\b/i,
  /\bno longer\b/i,
  /\bout of scope\b/i,
  /\bblocked\b/i,
];

// Phrases that support the task.
export const SUPPORT_PATTERNS = [
  /\bapproved\b/i,
  /\baccepted\b/i,
  /\bagreed\b/i,
  /\bdecided to\b/i,
  /\bdecision:\s*(?:go|yes|proceed|approved|accepted)\b/i,
  /\bgo ahead\b/i,
  /\bsigned off\b/i,
  /\bconfirmed\b/i,
  /\bwill proceed\b/i,
  /\bin scope\b/i,
  /\bstatus:\s*(?:decided|done|approved|accepted)\b/i,
];

const NEGATION = /\b(?:not|never|no|isn['’]t|wasn['’]t|aren['’]t|weren['’]t|hasn['’]t|haven['’]t)\b/i;

/**
 * Normalises a word for comparison: lower case, letters and digits only, and a
 * trailing plural "s" removed from words of four letters or more so "PDFs" matches "pdf".
 * The same folding runs on both the summary and the page, so a word like "status"
 * becomes "statu" on both sides and still matches.
 * @param {string} word
 */
export function normaliseWord(word) {
  let w = String(word).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (w.length >= 4 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return w;
}

/**
 * The significant words of an issue summary: three or more characters, not a
 * stopword, not a bare number.
 * @param {string} summary
 * @returns {string[]}
 */
export function summaryTerms(summary) {
  const terms = [];
  for (const raw of String(summary || '').split(/[^A-Za-z0-9]+/)) {
    // Check stopwords before folding plurals, so "this" is dropped rather than becoming "thi".
    if (STOPWORDS.has(raw.toLowerCase())) continue;
    const w = normaliseWord(raw);
    if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    if (!terms.includes(w)) terms.push(w);
  }
  return terms;
}

/**
 * Does this sentence name the issue key as a whole word?
 * @param {string} sentence
 * @param {string} issueKey
 */
export function mentionsKey(sentence, issueKey) {
  if (!issueKey) return false;
  const escaped = issueKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9-])${escaped}(?![0-9])`, 'i').test(sentence);
}

/**
 * Works out whether, and why, a sentence is relevant to the task.
 * @returns {{relevant: boolean, reason: 'key'|'status'|'terms'|null, matchedTerms: string[]}}
 */
export function relevance(sentence, issueKey, terms) {
  if (mentionsKey(sentence, issueKey)) return { relevant: true, reason: 'key', matchedTerms: [] };
  if (/^status\s*[:-]/i.test(sentence)) return { relevant: true, reason: 'status', matchedTerms: [] };
  if (!terms.length) return { relevant: false, reason: null, matchedTerms: [] };
  const words = new Set(sentence.split(/[^A-Za-z0-9]+/).map(normaliseWord).filter(Boolean));
  const matchedTerms = terms.filter((t) => words.has(t));
  // At least 60 percent of the summary's words, and never fewer than two.
  const needed = Math.max(2, Math.ceil(terms.length * 0.6));
  const relevant = matchedTerms.length >= needed;
  return { relevant, reason: relevant ? 'terms' : null, matchedTerms };
}

/**
 * Is a supporting phrase at this position negated by a word just before it?
 * Looks back three words.
 */
function negatedBefore(sentence, index) {
  const before = sentence.slice(0, index).trim().split(/\s+/).slice(-3).join(' ');
  return NEGATION.test(before);
}

/**
 * Classifies one sentence.
 * @returns {{kind: 'support'|'conflict'|'mention', cue: string|null}}
 */
export function classifySentence(sentence) {
  if (/\?\s*$/.test(sentence)) return { kind: 'mention', cue: 'question' };
  for (const pattern of BLOCK_PATTERNS) {
    const m = sentence.match(pattern);
    if (m) return { kind: 'conflict', cue: m[0] };
  }
  for (const pattern of SUPPORT_PATTERNS) {
    const m = pattern.exec(sentence);
    if (m) {
      if (negatedBefore(sentence, m.index)) return { kind: 'conflict', cue: `negated "${m[0]}"` };
      return { kind: 'support', cue: m[0] };
    }
  }
  return { kind: 'mention', cue: null };
}

/**
 * Runs the whole rule set over one page's sentences.
 *
 * @param {string[]} sentences the page text split into sentences
 * @param {{key: string, summary: string}} issue
 * @returns {{verdict: 'supports'|'conflicts'|'missing', findings: Array<{sentence: string, kind: string, cue: string|null, reason: string, matchedTerms: string[]}>}}
 */
export function classifyPage(sentences, issue) {
  const terms = summaryTerms(issue.summary);
  const findings = [];
  for (const sentence of sentences) {
    const rel = relevance(sentence, issue.key, terms);
    if (!rel.relevant) continue;
    const { kind, cue } = classifySentence(sentence);
    findings.push({ sentence, kind, cue, reason: rel.reason, matchedTerms: rel.matchedTerms });
  }
  let verdict = 'missing';
  if (findings.some((f) => f.kind === 'conflict')) verdict = 'conflicts';
  else if (findings.some((f) => f.kind === 'support')) verdict = 'supports';
  return { verdict, findings };
}

/**
 * Combines page verdicts into one result for the issue. Never returns "approved".
 *
 * @param {Array<{status: string, verdict?: string}>} pages each page's fetch status and verdict
 * - no-links: the issue links no Confluence page on this site.
 * - conflict: at least one checked page conflicts with the task.
 * - all-support: every linked page was checked and supports the task.
 * - incomplete: some pages support the task, others are missing the decision or could not be checked.
 * - missing: pages were checked and none supports the task.
 * - unchecked: no linked page could be checked.
 * @returns {'no-links'|'conflict'|'all-support'|'incomplete'|'missing'|'unchecked'}
 */
export function overallVerdict(pages) {
  if (!pages.length) return 'no-links';
  const checked = pages.filter((p) => p.status === 'ok');
  if (checked.some((p) => p.verdict === 'conflicts')) return 'conflict';
  if (!checked.length) return 'unchecked';
  const supports = checked.filter((p) => p.verdict === 'supports').length;
  if (supports === pages.length) return 'all-support';
  if (supports > 0) return 'incomplete';
  return 'missing';
}
