/**
 * The deterministic rules that decide what a linked page says about a task.
 *
 * No model is involved. Every verdict comes from the rules below and the panel shows
 * the text each verdict came from, so a reviewer can check the rules' work. The full
 * description, with measured accuracy and known limits, is in docs/rules.md.
 *
 * Bump RULES_VERSION whenever a change here can change a verdict; recorded checks made
 * under an older version are then reported as stale.
 */
import { stem, stems, taskAction, directionOf, familiesIn } from './direction.js';
import { splitSentences } from './text.js';

export const RULES_VERSION = 3;

// Short words and filler that carry no meaning about the task.
const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'also', 'and', 'any', 'are', 'because', 'been',
  'before', 'being', 'below', 'between', 'both', 'but', 'can', 'could', 'did', 'does', 'doing',
  'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having',
  'here', 'how', 'into', 'its', 'just', 'more', 'most', 'must', 'new', 'not', 'now', 'off',
  'once', 'only', 'other', 'our', 'out', 'over', 'own', 'per', 'same', 'should', 'some', 'such',
  'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'too', 'under', 'until', 'very', 'was', 'were', 'what', 'when', 'where', 'which',
  'while', 'who', 'why', 'will', 'with', 'would', 'you', 'your', 'task', 'issue', 'story', 'ticket',
]);

// Cues, each with the kind of decision it signals. A cue's position in the sentence
// matters: the last decisive cue wins ("approved in March, then reverted in April").
const SUPPORT_CUES = [
  /\bapproved\b/i, /\baccepted\b/i, /\bagreed\b/i, /\bdecided to\b/i, /\bgo ahead\b/i, /\bgoes ahead\b/i,
  /\bgoing ahead\b/i, /\bgreen ?light\b/i, /\bgreenlit\b/i, /\bsigned off\b/i,
  /\bconfirmed\b/i, /\bwill proceed\b/i, /\bproceed with\b/i, /\bin scope\b/i, /\bmandatory\b/i,
  /\bratified\b/i, /\bendorsed\b/i, /\bchose to\b/i, /\bsettled on\b/i,
  /^\s*(?:decision|decided|agreed|approved|outcome|resolution|resolved)\s*:/i,
  /:\s*(?:yes|approved|go|agreed|accepted|decided)\b\.?\s*$/i,
];
const BLOCK_CUES = [
  /\bwill not\b/i, /\bwon['’]t\b/i, /\bshall not\b/i, /\bmust not\b/i, /\bdo not\b/i, /\bdon['’]t\b/i,
  /\bshould not\b/i, /\bnot going to\b/i, /\bnever\b/i,
  /\bnot (?:be |been |yet )?(?:approved|accepted|agreed|proceed|go ahead|ship|release|happen)/i,
  /\brejected\b/i, /\bdeclined\b/i, /\bvetoed\b/i, /\bturned down\b/i, /\bdecided (?:not to|against)\b/i,
  /\b(?:chose|opted) not to\b/i, /\bdeferred\b/i, /\bpostponed\b/i, /\bdelayed\b/i, /\bon hold\b/i,
  /\bpaused\b/i, /\bcancel(?:l)?ed\b/i, /\bout of scope\b/i, /\bblocked\b/i, /\bno[- ]go\b/i,
];
const REVERSAL_CUES = [
  /\bsuperseded\b/i, /\breverted\b/i, /\brolled back\b/i, /\breplaced by\b/i, /\boverturned\b/i,
  /\breversed\b/i, /\bwithdrawn\b/i, /\bbacked out\b/i, /\bundone\b/i, /\bno longer\b/i,
];
// Sentences that say no decision exists. They win over any support cue.
const NO_DECISION = [
  /\bnothing (?:was |has been |is )?(?:agreed|decided)\b/i, /\bno (?:decision|agreement)\b/i,
  /\bnobody (?:has )?decided\b/i, /\bnot (?:yet )?decided\b/i, /\bundecided\b/i, /\bto be decided\b/i,
  /\btbd\b/i, /\bstill open\b/i, /\bopen question\b/i,
];
// Hedges turn support into a mention: the decision is not final.
const HEDGES = [
  /\bin principle\b/i, /\bpending\b/i, /\bsubject to\b/i, /\bprovisional(?:ly)?\b/i, /\btentative(?:ly)?\b/i,
  /\bprobably\b/i, /\blikely\b/i, /\bmight\b/i, /\bmay (?:be|not|need|want|have|go)\b/i, /\bcould\b/i,
  /\bconsider(?:ing|ed)?\b/i, /\bpropos(?:ed|al|e)\b/i, /\bsuggest(?:ed|ion)?\b/i, /\bif\b/i,
  /\bonce\b/i, /\bunless\b/i, /\bhope\b/i,
];
// Opinion words make the whole sentence a mention, whatever it argues for.
const OPINION = [/\b(?:i|we|they) (?:don['’]t |do not )?(?:think|believe|feel)\b/i];
// Partial approvals withhold part of the task as written.
const PARTIAL = [
  /\bonly\b/i, /\bexcept\b/i, /\bpartial(?:ly)?\b/i, /\bfirst phase\b/i, /\bas a pilot\b/i, /\bpilot only\b/i,
  /\blimited to\b/i,
];
// A stated plan: a future verb, or a date or release.
const MONTHS = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const DATED = new RegExp(
  `\\b(?:from|on|by|starting|in|at the end of)\\s+(?:\\d{1,2}\\s+${MONTHS}|${MONTHS}|q[1-4]|release\\s+v?[\\d.]+|v?\\d+\\.\\d+|next (?:release|sprint|quarter|month|week)|\\d{4})\\b`,
  'i'
);
const PLAN = [/\b(?:will|shall)\s+(?:be\s+)?\w+/i, /\b(?:is|are) going to\b/i, DATED];
const DONE = /\b(?:was|were|has been|have been|is now|are now)\s+\w+/i;
const NEGATION = /\b(?:not|never|no|isn['’]t|wasn['’]t|aren['’]t|weren['’]t|hasn['’]t|haven['’]t)\b/i;

// Status values from status lozenges, status lines and status columns.
const STATUS_SUPPORT = /^(?:decided|approved|accepted|agreed|done|complete|completed|go|yes|signed off|final|in effect|adopted)$/i;
const STATUS_CONFLICT = /^(?:rejected|declined|superseded|deferred|on hold|cancell?ed|blocked|reverted|withdrawn|no go|no-go|won['’]t do|abandoned|obsolete)$/i;
const STATUS_OPEN = /^(?:not started|in progress|in review|under review|draft|proposed|open|pending|other|tbd|undecided|new|to do)$/i;
const STATUS_LABEL = /^(?:status|outcome|decision status|state|result|resolution)$/i;

/** The significant words of an issue summary, stemmed. */
export function summaryTerms(summary) {
  const terms = [];
  for (const raw of String(summary || '').split(/[^A-Za-z0-9]+/)) {
    if (!raw || STOPWORDS.has(raw.toLowerCase())) continue;
    const w = stem(raw);
    if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    if (!terms.includes(w)) terms.push(w);
  }
  return terms;
}

/** Kept for callers that normalise single words. */
export const normaliseWord = stem;

const KEY_PATTERN = /\b[A-Z][A-Z0-9_]+-\d+\b/g;

/** Does this text name the issue key (or one of its earlier keys) as a whole key? */
export function mentionsKey(text, keys) {
  const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
  return list.some((key) => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9-])${escaped}(?![0-9])`, 'i').test(text);
  });
}

/** Issue keys named in a text that are not this task's. */
function otherKeys(text, keys) {
  const own = new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean).map((k) => k.toUpperCase()));
  return (String(text).match(KEY_PATTERN) || []).filter((k) => !own.has(k.toUpperCase()));
}

/**
 * Is a text about the task? It names the key, or it uses at least 60 percent of the
 * summary's significant words, and never fewer than two.
 * @returns {{relevant: boolean, reason: 'key'|'terms'|null, matchedTerms: string[]}}
 */
export function relevance(text, keys, terms, object = []) {
  if (mentionsKey(text, keys)) return { relevant: true, reason: 'key', matchedTerms: [] };
  if (!terms.length) return { relevant: false, reason: null, matchedTerms: [] };
  const words = new Set(stems(text));
  const matchedTerms = terms.filter((t) => words.has(t));
  const needed = Math.max(2, Math.ceil(terms.length * 0.6));
  if (matchedTerms.length >= needed) return { relevant: true, reason: 'terms', matchedTerms };
  // Weak match: the sentence names the task's object ("the status page") in full. It
  // only counts when the sentence also carries a decision signal; see classifyPage.
  const objectHit = object.length >= 2 ? object.every((t) => words.has(t)) : object.length === 1 && words.has(object[0]) && matchedTerms.length >= 2;
  if (objectHit) return { relevant: true, reason: 'object', matchedTerms };
  return { relevant: false, reason: null, matchedTerms };
}

const PREPOSITIONS = new Set(['to', 'for', 'in', 'on', 'from', 'by', 'with', 'at', 'into', 'of', 'across', 'via', 'as', 'after', 'before', 'until']);

/**
 * The task's object: the summary words after its action verb, up to the first
 * preposition. "Move the status page to a managed provider" gives "status page".
 */
export function taskObject(summary, action) {
  if (!action) return [];
  const words = String(summary).split(/[^A-Za-z0-9]+/).filter(Boolean);
  let i = words.findIndex((w) => familiesIn(w).has(action));
  if (i < 0) return [];
  if (/^(turn|switch|roll|go|shut|phase)$/i.test(words[i]) && words[i + 1] && /^(on|off|out|live|down)$/i.test(words[i + 1])) i += 1;
  const out = [];
  for (const w of words.slice(i + 1)) {
    if (PREPOSITIONS.has(w.toLowerCase())) break;
    if (STOPWORDS.has(w.toLowerCase())) continue;
    const st = stem(w);
    if (st.length >= 2 && !/^\d+$/.test(st)) out.push(st);
  }
  return out;
}

/** All cue matches in a sentence, with their position and kind, in order. */
function cuesIn(sentence) {
  const found = [];
  const scan = (list, kind) => {
    for (const re of list) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      let m;
      while ((m = g.exec(sentence))) {
        found.push({ kind, index: m.index, end: m.index + m[0].length, text: m[0].trim() });
        if (m[0].length === 0) break;
      }
    }
  };
  scan(SUPPORT_CUES, 'support');
  scan(BLOCK_CUES, 'block');
  scan(REVERSAL_CUES, 'reversal');
  // A supporting cue with a negation just before it blocks instead: "was not approved".
  for (const c of found) {
    if (c.kind !== 'support') continue;
    const before = sentence.slice(0, c.index).trim().split(/\s+/).slice(-3).join(' ');
    if (NEGATION.test(before)) c.kind = 'block';
  }
  // A blocking phrase that contains a supporting word ("not approved") replaces that word.
  return found
    .filter((c) => !(c.kind === 'support' && found.some((o) => o !== c && o.kind !== 'support' && o.index <= c.index && o.end >= c.end)))
    .sort((a, b) => a.index - b.index || b.end - a.end);
}

/** The clause around a position: split at ";", ",", "but", "so", "then" and similar. */
function clauseAt(sentence, index) {
  const re = /[;,]|\s(?:but|so|then|and then|while|although|however|whereas)\s/gi;
  let start = 0;
  let m;
  while ((m = re.exec(sentence))) {
    if (m.index >= index) return sentence.slice(start, m.index);
    start = m.index + m[0].length;
  }
  return sentence.slice(start);
}

const any = (list, text) => list.some((re) => re.test(text));
const firstMatch = (list, text) => {
  for (const re of list) {
    const m = text.match(re);
    if (m) return m[0].trim();
  }
  return null;
};

/**
 * Classifies one sentence against the task.
 * @param {string} sentence
 * @param {{action: string|null}} task from prepareTask()
 * @returns {{kind: 'support'|'conflict'|'mention', cue: string|null}}
 */
export function classifySentence(sentence, task = { action: null }) {
  const s = String(sentence);
  if (/\?\s*$/.test(s)) return { kind: 'mention', cue: 'question' };
  const noDecision = firstMatch(NO_DECISION, s);
  if (noDecision) return { kind: 'mention', cue: `no decision: "${noDecision}"` };
  const opinion = firstMatch(OPINION, s);
  if (opinion) return { kind: 'mention', cue: `opinion: "${opinion}"` };

  const cues = cuesIn(s);
  if (!cues.length) {
    const dir = directionOf(s, task.action);
    if (dir === 'opposite') return { kind: 'conflict', cue: 'states the opposite of the task' };
    const hedge = firstMatch(HEDGES, s);
    if (hedge) return { kind: 'mention', cue: `hedged: "${hedge}"` };
    if (dir === 'same' && (any(PLAN, s) || DONE.test(s))) return { kind: 'support', cue: 'states the task as planned or done' };
    if (dir === 'same' && task.action === 'keep') return { kind: 'support', cue: 'states it stays as it is' };
    if (dir === null && DATED.test(s)) return { kind: 'support', cue: 'states a dated plan' };
    return { kind: 'mention', cue: null };
  }

  const last = cues[cues.length - 1];
  const clause = clauseAt(s, last.index);
  // A refusal applies to its own clause only ("DREC-1 rejected, keep the endpoint" refuses
  // the task, not the keeping). An approval may name its object later in the sentence.
  const clauseDir = directionOf(clause, task.action);
  const dir = last.kind === 'support' ? clauseDir ?? directionOf(s, task.action) : clauseDir;

  if (last.kind === 'support') {
    if (dir === 'opposite') return { kind: 'conflict', cue: `"${last.text}" for the opposite of the task` };
    const partial = firstMatch(PARTIAL, clause);
    if (partial) return { kind: 'conflict', cue: `partial: "${last.text}" with "${partial}"` };
    const hedge = firstMatch(HEDGES, clause);
    if (hedge) return { kind: 'mention', cue: `hedged: "${last.text}" with "${hedge}"` };
    return { kind: 'support', cue: `phrase "${last.text}"` };
  }
  if (last.kind === 'block' && dir === 'opposite') {
    return { kind: 'support', cue: `"${last.text}" for the opposite of the task` };
  }
  return { kind: 'conflict', cue: `phrase "${last.text}"` };
}

/** Everything about the task the rules need, computed once per check. */
export function prepareTask(issue) {
  const keys = [issue.key, ...(issue.previousKeys || [])].filter(Boolean);
  const action = taskAction(issue.summary);
  // Stem to the summary's own word, so explanations read "invoice", not "invoic".
  const words = {};
  for (const raw of String(issue.summary || '').split(/[^A-Za-z0-9]+/)) if (raw && !words[stem(raw)]) words[stem(raw)] = raw.toLowerCase();
  return { keys, terms: summaryTerms(issue.summary), action, object: taskObject(issue.summary, action), words };
}

/** Reads a status value: support, conflict, open (not decided) or null (not a status). */
export function statusKind(value) {
  const v = String(value || '').replace(/[.\s]+$/, '').trim();
  // The value is the whole text, or its first words followed by a qualifier
  // ("Superseded by the March review", "Approved, see notes").
  const head = (re) => re.test(v) || new RegExp(re.source.replace(/\$$/, '(?=[\\s,;:(-])'), re.flags).test(v);
  if (head(STATUS_SUPPORT)) return 'support';
  if (head(STATUS_CONFLICT)) return 'conflict';
  if (head(STATUS_OPEN)) return 'open';
  return null;
}

/**
 * Is a unit a status statement whose subject is elsewhere (a label row such as
 * "Status | DECIDED", or a line such as "Status: Approved")? Returns its value.
 */
export function standaloneStatus(unit) {
  if (unit.kind === 'row' && unit.cells && unit.cells.filter(Boolean).length === 2 && STATUS_LABEL.test(unit.cells[0])) {
    return unit.statuses.length > 1 ? 'ambiguous' : unit.statuses[0] || unit.cells[1];
  }
  if (unit.kind === 'text') {
    const m = unit.text.match(/^(?:status|outcome|decision status|resolution)\s*[:-]\s*(.+)$/i);
    if (m) return unit.statuses.length > 1 ? 'ambiguous' : unit.statuses[0] || m[1];
  }
  return null;
}

/** For a table row with a status column or one status lozenge, the status value. */
function rowStatus(unit) {
  if (unit.kind !== 'row' || unit.header) return null;
  if (unit.statuses.length === 1) return unit.statuses[0];
  if (unit.statuses.length > 1) return 'ambiguous';
  if (unit.columns) {
    const col = unit.columns.findIndex((c) => STATUS_LABEL.test(c || ''));
    if (col >= 0 && unit.cells[col]) return unit.cells[col];
  }
  return null;
}

/** The finding kind for a status value, given which way the decided thing points. */
function fromStatus(kind, dir) {
  if (kind === 'open') return 'mention';
  if (kind === 'support') return dir === 'opposite' ? 'conflict' : 'support';
  return dir === 'opposite' ? 'support' : 'conflict';
}

/**
 * Runs the rules over a page's units.
 *
 * Status statements apply to their scope only: the table they sit in, or the section
 * under their heading (with the page title for the first section). They count only when
 * that scope is about the task and names no other issue instead.
 *
 * @param {Array} units from parseStorage()
 * @param {{key: string, summary: string, previousKeys?: string[]}} issue
 * @returns {{verdict: 'supports'|'conflicts'|'missing', findings: Array}}
 */
export function classifyPage(units, issue) {
  const task = prepareTask(issue);
  const findings = [];
  const add = (unit, sentence, kind, cue, reason, matchedTerms = []) =>
    findings.push({
      sentence,
      kind,
      cue,
      reason,
      matchedTerms: matchedTerms.map((t) => task.words[t] || t),
      unitKind: unit.kind,
      section: unit.heading || '',
    });

  const inScope = (unit, u) => {
    if (u === unit) return false;
    if (unit.table !== null && u.table === unit.table) return true;
    if (u.section !== unit.section) return false;
    if (u.kind === 'heading' || u.kind === 'title') return true;
    return unit.table === null && u.table === null;
  };

  for (const unit of units) {
    if (unit.kind === 'title' || unit.kind === 'heading' || unit.header) continue;

    // 1. Status statements that need their scope.
    const status = standaloneStatus(unit);
    if (status) {
      const kind = status === 'ambiguous' ? null : statusKind(status);
      if (!kind) continue; // an unfilled template offering several choices, or not a status
      const scope = units.filter((u) => inScope(unit, u));
      const scopeText = scope.map((u) => u.text).join(' \n ');
      if (!scope.some((u) => relevance(u.text, task.keys, task.terms).relevant)) continue;
      const mine = mentionsKey(scopeText, task.keys);
      const others = otherKeys(scopeText, task.keys);
      if (others.length && !mine) continue;
      if (others.length && mine) {
        add(unit, unit.text, 'mention', 'status shared by several issues', 'status');
        continue;
      }
      const statement = scope.find(
        (u) => ['decision', 'heading', 'title', 'row'].includes(u.kind) && relevance(u.text, task.keys, task.terms).relevant
      );
      const dir = statement ? directionOf(statement.text, task.action) : null;
      const cue = kind === 'open' ? `status "${status}" is not a decision` : dir === 'opposite' ? `status "${status}" for the opposite of the task` : `status "${status}"`;
      add(unit, unit.text, fromStatus(kind, dir), cue, 'status');
      continue;
    }

    // 2. Rows, tasks and decision items are judged whole.
    if (unit.kind === 'row' || unit.kind === 'task' || unit.kind === 'decision') {
      const rel = relevance(unit.text, task.keys, task.terms, task.object);
      if (!rel.relevant) continue;
      const st = rowStatus(unit);
      if (st && st !== 'ambiguous' && statusKind(st)) {
        const rest = unit.cells.filter((c) => c && c !== st).join(' | ');
        const dir = directionOf(rest, task.action);
        add(unit, unit.text, fromStatus(statusKind(st), dir), `status "${st}"`, rel.reason, rel.matchedTerms);
        continue;
      }
      let { kind, cue } = classifySentence(unit.text, task);
      if (unit.kind === 'task') {
        if (unit.taskState !== 'complete' && kind === 'support') {
          kind = 'mention';
          cue = 'open task, not done';
        } else if (unit.taskState === 'complete' && kind === 'mention' && /^(?:approve|accept|agree|sign off|decide|confirm)\b/i.test(unit.text)) {
          kind = directionOf(unit.text, task.action) === 'opposite' ? 'conflict' : 'support';
          cue = 'approval task marked done';
        }
      }
      if (unit.kind === 'decision') {
        if (unit.decisionState === 'DECIDED' && kind === 'mention' && !/hedged|question|no decision|opinion/.test(cue || '')) {
          kind = directionOf(unit.text, task.action) === 'opposite' ? 'conflict' : 'support';
          cue = 'decision item marked decided';
        } else if (unit.decisionState !== 'DECIDED' && kind === 'support') {
          kind = 'mention';
          cue = 'decision item not marked decided';
        }
      }
      if (rel.reason === 'object' && kind === 'mention' && !cue) continue;
      add(unit, unit.text, kind, cue, rel.reason, rel.matchedTerms);
      continue;
    }

    // 3. Paragraphs and list items, sentence by sentence.
    for (const sentence of splitSentences(unit.text)) {
      const rel = relevance(sentence, task.keys, task.terms, task.object);
      if (!rel.relevant) continue;
      const { kind, cue } = classifySentence(sentence, task);
      if (rel.reason === 'object' && kind === 'mention' && !cue) continue;
      add(unit, sentence, kind, cue, rel.reason, rel.matchedTerms);
    }
  }

  let verdict = 'missing';
  if (findings.some((f) => f.kind === 'conflict')) verdict = 'conflicts';
  else if (findings.some((f) => f.kind === 'support')) verdict = 'supports';
  return { verdict, findings };
}

/**
 * Combines page verdicts into one result for the issue. Never returns "approved".
 * Links the panel did not read (other sites, short links, past the page limit) keep
 * the result from reaching "all-support".
 *
 * @param {Array<{status: string, verdict?: string}>} pages
 * @param {{otherSite?: number, unreadable?: number, skipped?: number}} [unread]
 * @returns {'no-links'|'conflict'|'all-support'|'incomplete'|'missing'|'unchecked'}
 */
export function overallVerdict(pages, unread = {}) {
  const unreadLinks = (unread.otherSite || 0) + (unread.unreadable || 0) + (unread.skipped || 0);
  if (!pages.length) return unreadLinks ? 'unchecked' : 'no-links';
  const checked = pages.filter((p) => p.status === 'ok');
  if (checked.some((p) => p.verdict === 'conflicts')) return 'conflict';
  if (!checked.length) return 'unchecked';
  const supports = checked.filter((p) => p.verdict === 'supports').length;
  if (supports === pages.length && !unreadLinks) return 'all-support';
  if (supports > 0) return 'incomplete';
  return 'missing';
}
