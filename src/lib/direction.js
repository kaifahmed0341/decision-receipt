/**
 * Which way a sentence points compared with the task.
 *
 * A decision only supports a task if it decides the same change the task makes.
 * "We agreed to keep the endpoint" contains "agreed", but it keeps what the task
 * removes. This module finds the task's action from the first verb of the issue
 * summary, and checks whether a sentence names that action or its opposite.
 *
 * Words are compared by a light stem, so "retire", "retired", "retiring" and
 * "retirement" all match.
 */

/** A light stemmer: lower case, plural and verb endings removed. Same rules on both sides. */
export function stem(word) {
  let w = String(word).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (w.length <= 3 || /^\d+$/.test(w)) return w;
  const strip = (suffix, add = '') => {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      w = w.slice(0, -suffix.length) + add;
      return true;
    }
    return false;
  };
  strip('ations', 'ate') ||
    strip('ation', 'ate') ||
    strip('ments') ||
    strip('ment') ||
    strip('ings') ||
    strip('ing') ||
    strip('ied', 'y') ||
    strip('ies', 'y') ||
    (w.endsWith('eed') ? strip('d') : strip('ed')) ||
    (!w.endsWith('ss') && !w.endsWith('us') && strip('s'));
  if (w.length > 6) strip('al');
  if (w.length > 3 && w.endsWith('e') && !w.endsWith('ee')) w = w.slice(0, -1);
  if (w.length > 3 && /([bdfgklmnprt])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}

/** Stems of every word in a text. */
export function stems(text) {
  return String(text)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(stem);
}

// Action families. Single words are stems; phrases are matched on the lower-case text.
export const FAMILIES = {
  remove: {
    words: ['remov', 'retir', 'drop', 'delet', 'deprecat', 'sunset', 'decommission', 'archiv', 'discontinu', 'kill', 'scrap'],
    phrases: ['shut down', 'phase out', 'phased out', 'end of life', 'turn down'],
  },
  keep: {
    words: ['keep', 'kept', 'retain', 'maintain', 'preserv', 'stay', 'remain', 'continu', 'unchang'],
    phrases: ['as is', 'leave it', 'leave the', 'no change'],
  },
  enable: {
    words: ['enabl', 'activat', 'allow', 'add', 'introduc', 'adopt', 'launch', 'ship', 'releas', 'rollout', 'implement', 'offer', 'introduc'],
    phrases: ['turn on', 'turned on', 'turns on', 'roll out', 'rolls out', 'rolled out', 'go live', 'goes live', 'went live', 'switch on'],
  },
  disable: {
    words: ['disabl', 'deactivat', 'forbid', 'prohibit'],
    phrases: ['turn off', 'turned off', 'turns off', 'switch off', 'switched off'],
  },
  increase: {
    words: ['increas', 'rais', 'extend', 'expand', 'grow', 'lengthen', 'boost', 'bump'],
    phrases: [],
  },
  decrease: {
    words: ['decreas', 'reduc', 'lower', 'shorten', 'cut'],
    phrases: [],
  },
  change: {
    words: ['migrat', 'mov', 'switch', 'chang', 'replac', 'upgrad', 'renam', 'convert', 'transit', 'port', 'redesign', 'rewrit', 'refactor', 'stor'],
    phrases: [],
  },
};

// What counts as the opposite of each task action. Keeping things as they are opposes
// every change.
export const OPPOSITES = {
  remove: ['keep'],
  keep: ['remove', 'change', 'disable'],
  enable: ['disable', 'keep', 'remove'],
  disable: ['enable', 'keep'],
  increase: ['decrease', 'keep'],
  decrease: ['increase', 'keep'],
  change: ['keep'],
};

/** Which families appear in a text. */
export function familiesIn(text) {
  const lower = ` ${String(text).toLowerCase().replace(/\s+/g, ' ')} `;
  const words = new Set(stems(text));
  const found = new Set();
  for (const [name, fam] of Object.entries(FAMILIES)) {
    if (fam.words.some((w) => words.has(w)) || fam.phrases.some((p) => lower.includes(` ${p} `) || lower.includes(` ${p},`) || lower.includes(` ${p}.`))) {
      found.add(name);
    }
  }
  return found;
}

/**
 * The task's action: the family of the first word of the summary that belongs to one.
 * @param {string} summary
 * @returns {string|null}
 */
export function taskAction(summary) {
  const words = String(summary).split(/\s+/).filter(Boolean);
  for (let i = 0; i < Math.min(words.length, 4); i += 1) {
    const fams = familiesIn(words.slice(i, i + 2).join(' '));
    const single = familiesIn(words[i]);
    const pick = single.size ? single : fams;
    if (pick.size) return [...pick][0];
  }
  return null;
}

/**
 * Does the text point the same way as the task, the opposite way, or neither?
 * @returns {'same'|'opposite'|null}
 */
export function directionOf(text, action) {
  if (!action) return null;
  const found = familiesIn(text);
  const same = found.has(action);
  const opposite = OPPOSITES[action].some((f) => found.has(f));
  if (same && !opposite) return 'same';
  if (opposite && !same) return 'opposite';
  return null;
}
