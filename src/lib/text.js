/**
 * Text helpers: entity decoding, sentence splitting and Jira's document format.
 * Page bodies are read by storage.js, which uses these.
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  hellip: '...',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
};

/**
 * Decodes HTML entities such as &amp; and &#39;.
 * @param {string} text
 */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    const named = NAMED_ENTITIES[code.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

const ABBREVIATIONS = /(?:\b(?:e\.g|i\.e|etc|vs|approx|incl|no|nr|mr|ms|mrs|dr|st|fig|cf|al)\.)$/i;
// A short labelled verdict such as "Decision: go." belongs with the sentence after it.
const LABEL_ONLY = /^(?:decision|decided|outcome|status|agreed|approved|resolution)\s*:\s*[\w-]+\.$/i;

/**
 * Splits plain text into sentences. Each line is split on ". ", "! " and "? " so a
 * heading or list item stays one unit. Abbreviations such as "e.g." are kept whole, and
 * a short label such as "Decision: go." stays with the sentence after it.
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  if (!text) return [];
  const out = [];
  for (const line of text.split('\n')) {
    // Split after sentence punctuation followed by a space and an upper-case letter, digit or quote.
    const parts = line.split(/(?<=[.!?])\s+(?=["'(A-Z0-9])/);
    const merged = [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const prev = merged[merged.length - 1];
      if (prev && (ABBREVIATIONS.test(prev) || LABEL_ONLY.test(prev))) merged[merged.length - 1] = `${prev} ${trimmed}`;
      else merged.push(trimmed);
    }
    out.push(...merged);
  }
  return out;
}

/**
 * Extracts plain text from Atlassian Document Format (Jira descriptions and comments).
 * @param {object} adf
 * @returns {string}
 */
export function adfToText(adf) {
  if (!adf || typeof adf !== 'object') return '';
  const lines = [];
  let current = '';
  const blockTypes = new Set(['paragraph', 'heading', 'listItem', 'tableCell', 'tableHeader', 'blockquote', 'codeBlock']);
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text' && typeof node.text === 'string') current += node.text;
    if (node.type === 'hardBreak') current += '\n';
    if (Array.isArray(node.content)) node.content.forEach(walk);
    if (blockTypes.has(node.type)) {
      if (current.trim()) lines.push(current.trim());
      current = '';
    }
  };
  walk(adf);
  if (current.trim()) lines.push(current.trim());
  return lines.join('\n');
}
