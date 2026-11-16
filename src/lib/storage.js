/**
 * Reads a Confluence page body (storage format) into units the rules can judge.
 *
 * A unit is one thing a reader sees as a whole: a paragraph or list item (later split
 * into sentences), a heading, a table row (cells joined with " | "), a task with its
 * done state, or a decision item with its state. Each unit knows its section (the
 * heading above it) and its table, so a status line can be tied to what it is about.
 *
 * What a reader cannot see in view mode is dropped: editor placeholders, struck-out
 * and deleted text, hidden macros, macro parameters, and the fallback copy Confluence
 * stores next to native decision items. Structured values a reader does see are kept:
 * the text of a status lozenge, the issue key of a Jira issue macro, a task's done state
 * and a decision item's state.
 *
 * The shapes handled here were taken from pages Confluence itself produced on a test
 * site; samples are in test/storage-samples.
 */
import { decodeEntities } from './text.js';

// Elements whose content is never shown in view mode, or is not page content.
const DROP_TAGS = new Set([
  'ac:placeholder',
  'del',
  's',
  'strike',
  'ac:parameter',
  'ac:adf-fallback',
  'ac:adf-attribute',
  'ac:task-id',
  'ac:task-uuid',
  'ac:task-status',
  'at:declarations',
  'at:var',
  'colgroup',
  'script',
  'style',
  'ac:plain-text-body',
]);

// Macros whose body is code, navigation or content pulled from elsewhere.
const DROP_MACROS = new Set([
  'code',
  'noformat',
  'toc',
  'children',
  'anchor',
  'excerpt-include',
  'include',
  'attachments',
  'recently-updated',
  'contentbylabel',
  'create-from-template',
  'detailssummary',
  'pagetree',
  'livesearch',
]);

const VOID_TAGS = new Set(['br', 'hr', 'img', 'col', 'input', 'meta', 'link', 'wbr', 'ac:emoticon', 'ac:image']);
const HEADING = /^h[1-6]$/;
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'blockquote',
  'pre',
  'ul',
  'ol',
  'li',
  'section',
  'ac:layout',
  'ac:layout-section',
  'ac:layout-cell',
  'ac:rich-text-body',
  'ac:task-list',
  'ac:adf-extension',
  'ac:adf-content',
]);

/** Splits storage format into a light element tree. Tolerates unclosed and stray tags. */
export function parseTree(storage) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const token =
    /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|(<)/g;
  let m;
  while ((m = token.exec(storage || ''))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      top.children.push({ text: m[1] });
    } else if (m[3]) {
      const tag = m[3].toLowerCase();
      if (m[2]) {
        // Closing tag: pop to the matching open element, ignore it if there is none.
        const at = stack.map((n) => n.tag).lastIndexOf(tag);
        if (at > 0) stack.length = at;
      } else {
        const node = { tag, attrs: parseAttrs(m[4] || ''), children: [] };
        top.children.push(node);
        if (!m[5] && !VOID_TAGS.has(tag) && !tag.startsWith('ri:')) stack.push(node);
      }
    } else if (m[6] !== undefined) {
      top.children.push({ text: decodeEntities(m[6]) });
    } else if (m[7]) {
      top.children.push({ text: '<' });
    }
  }
  return root;
}

function parseAttrs(s) {
  const attrs = {};
  const re = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(s))) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

const isMacro = (n) => n.tag === 'ac:structured-macro' || n.tag === 'ac:macro';
const macroName = (n) => (n.attrs['ac:name'] || '').toLowerCase();

/** The value of a macro parameter, if present. */
function macroParam(node, name) {
  const p = (node.children || []).find((c) => c.tag === 'ac:parameter' && (c.attrs['ac:name'] || '').toLowerCase() === name);
  return p ? flatText(p, { raw: true }) : null;
}

/** Is this element hidden from readers in view mode? */
function isHidden(node) {
  if (!node.tag) return false;
  if (DROP_TAGS.has(node.tag)) return true;
  const style = (node.attrs.style || '').toLowerCase().replace(/\s+/g, '');
  if (/line-through/.test(style) || /display:none/.test(style) || /visibility:hidden/.test(style)) return true;
  if (/(?:^|;)opacity:0(?:\.0*)?(?:;|$)/.test(style) || /font-size:0(?:px|pt|em|rem|%)?(?:;|$)/.test(style)) return true;
  // White or transparent text is invisible on Confluence's light page.
  if (/(?:^|;)color:(?:#fff(?:fff)?|white|transparent|rgb\(255,255,255\)|rgba\([^)]*,0\))(?:;|$)/.test(style)) return true;
  if (isMacro(node)) {
    if (DROP_MACROS.has(macroName(node))) return true;
    if ((macroParam(node, 'hidden') || '').trim().toLowerCase() === 'true') return true;
  }
  return false;
}

/**
 * The visible text of an element, as one line. Collects status lozenge titles into
 * `statuses` when given. `raw` reads everything, for macro parameters.
 */
function flatText(node, opts = {}) {
  if (node.text !== undefined) return node.text;
  if (!opts.raw && isHidden(node)) return '';
  if (isMacro(node)) {
    const name = macroName(node);
    if (name === 'status') {
      const title = (macroParam(node, 'title') || '').trim();
      if (title && opts.statuses) opts.statuses.push(title);
      return title ? ` ${title} ` : '';
    }
    if (name === 'jira') {
      const key = (macroParam(node, 'key') || '').trim();
      return key ? ` ${key} ` : '';
    }
  }
  if (node.tag === 'ac:link') {
    const body = (node.children || []).find((c) => c.tag === 'ac:plain-text-link-body' || c.tag === 'ac:link-body');
    if (body) return flatText(body, opts);
    const page = (node.children || []).find((c) => c.tag === 'ri:page');
    return page ? ` ${page.attrs['ri:content-title'] || ''} ` : '';
  }
  if (node.tag === 'br') return ' ';
  const sep = BLOCK_TAGS.has(node.tag) || HEADING.test(node.tag) || node.tag === 'tr' ? ' ' : '';
  return (node.children || []).map((c) => flatText(c, opts)).join('') + sep;
}

const clean = (s) => s.replace(/[\s ]+/g, ' ').trim();

/**
 * Reads storage format into units.
 * @param {string} storage page body in storage format
 * @param {string} [title] page title; added as the first unit, kind "title"
 * @returns {Array<{text: string, kind: string, section: number, heading: string, table: number|null,
 *   cells?: string[], header?: boolean, statuses: string[], taskState?: string, decisionState?: string}>}
 */
export function parseStorage(storage, title) {
  const units = [];
  let section = 0;
  let heading = title ? clean(title) : '';
  let tableCount = 0;
  let table = null;
  let tableHeader = null;
  let buffer = [];
  let statuses = [];

  if (title) units.push({ text: clean(title), kind: 'title', section: 0, heading, table: null, statuses: [] });

  const flush = () => {
    const text = clean(buffer.join(''));
    if (/[A-Za-z0-9]/.test(text)) units.push({ text, kind: 'text', section, heading, table, statuses });
    buffer = [];
    statuses = [];
  };

  const walk = (node) => {
    for (const child of node.children || []) visit(child);
  };

  const visit = (node) => {
    if (node.text !== undefined) {
      buffer.push(node.text);
      return;
    }
    if (isHidden(node)) return;
    const tag = node.tag;

    if (HEADING.test(tag)) {
      flush();
      const text = clean(flatText(node));
      section += 1;
      heading = text;
      if (text) units.push({ text, kind: 'heading', section, heading, table: null, statuses: [] });
      return;
    }

    if (tag === 'table') {
      flush();
      const outer = { table, tableHeader };
      tableCount += 1;
      table = tableCount;
      tableHeader = null;
      walk(node);
      flush();
      ({ table, tableHeader } = outer);
      return;
    }

    if (tag === 'tr') {
      flush();
      const cellNodes = (node.children || []).filter((c) => c.tag === 'td' || c.tag === 'th');
      const rowStatuses = [];
      const cells = cellNodes.map((c) => clean(flatText(c, { statuses: rowStatuses })));
      const header = cellNodes.length > 0 && cellNodes.every((c) => c.tag === 'th') && tableHeader === null && !rowStatuses.length;
      if (header) tableHeader = cells;
      const text = cells.filter(Boolean).join(' | ');
      if (text) {
        units.push({ text, kind: 'row', section, heading, table, cells, header, columns: tableHeader, statuses: rowStatuses });
      }
      return;
    }

    if (tag === 'ac:task') {
      flush();
      const state = (node.children || []).find((c) => c.tag === 'ac:task-status');
      const body = (node.children || []).find((c) => c.tag === 'ac:task-body');
      const taskStatuses = [];
      const text = body ? clean(flatText(body, { statuses: taskStatuses })) : '';
      if (text) {
        units.push({
          text,
          kind: 'task',
          section,
          heading,
          table,
          statuses: taskStatuses,
          taskState: state ? clean(flatText(state, { raw: true })).toLowerCase() : 'incomplete',
        });
      }
      return;
    }

    if (tag === 'ac:adf-node' && node.attrs.type === 'decision-item') {
      flush();
      const stateAttr = (node.children || []).find((c) => c.tag === 'ac:adf-attribute' && c.attrs.key === 'state');
      const content = (node.children || []).find((c) => c.tag === 'ac:adf-content');
      const text = content ? clean(flatText(content)) : '';
      if (text) {
        units.push({
          text,
          kind: 'decision',
          section,
          heading,
          table,
          statuses: [],
          decisionState: stateAttr ? clean(flatText(stateAttr, { raw: true })).toUpperCase() : '',
        });
      }
      return;
    }

    if (isMacro(node)) {
      const name = macroName(node);
      if (name === 'status' || name === 'jira') {
        buffer.push(flatText(node, { statuses }));
        return;
      }
      // Panels, expands, page properties and other wrappers: read their body. Expands and
      // panels also show their title to readers, so the title is read as a line.
      flush();
      if (/^(?:expand|panel|info|note|tip|warning|ui-expand|section)$/.test(name)) {
        const t = clean(macroParam(node, 'title') || '');
        if (/[A-Za-z0-9]/.test(t)) units.push({ text: t, kind: 'text', section, heading, table, statuses: [] });
      }
      walk(node);
      flush();
      return;
    }

    if (tag === 'ac:link') {
      buffer.push(flatText(node));
      return;
    }
    if (tag === 'br') {
      buffer.push(' ');
      return;
    }

    if (BLOCK_TAGS.has(tag) || tag === 'td' || tag === 'th') {
      flush();
      walk(node);
      flush();
      return;
    }
    walk(node);
  };

  walk(parseTree(storage));
  flush();
  return units;
}
