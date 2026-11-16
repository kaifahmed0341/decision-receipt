/**
 * Converts a Confluence page body (storage format, which is XHTML with some
 * Confluence-specific tags) into plain text, then into sentences.
 *
 * The excerpts the panel shows are cut from this plain text without rewording, so a
 * reviewer can search the page for the same words.
 */

// Tags that end a block of text. Each becomes a line break.
const BLOCK_TAGS =
  'p|div|h[1-6]|li|tr|td|th|blockquote|pre|ul|ol|table|section|ac:task|ac:layout-cell|ac:rich-text-body';

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

/**
 * Turns Confluence storage format into plain text lines.
 * Macro parameters (for example a code block's language) are dropped; macro bodies are kept.
 * @param {string} storage
 * @returns {string}
 */
export function storageToText(storage) {
  if (typeof storage !== 'string' || storage.length === 0) return '';
  let s = storage;
  s = s.replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/gi, ' ');
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner) => inner.replace(/</g, '&lt;'));
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(new RegExp(`</?(?:${BLOCK_TAGS})(?:\\s[^>]*)?>`, 'gi'), '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s.replace(/[ \t ]+/g, ' ');
  return s
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Splits plain text into sentences. Each line is split on ". ", "! " and "? " so a
 * heading or list item stays one unit. Abbreviations such as "e.g." are kept whole.
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  if (!text) return [];
  const out = [];
  for (const line of text.split('\n')) {
    // Split after sentence punctuation followed by a space and an upper-case letter, digit or quote.
    const parts = line.split(/(?<=[.!?])\s+(?=["'(A-Z0-9])/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) out.push(trimmed);
    }
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
