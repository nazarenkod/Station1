import {compileMasks, maskText} from './privacy.js';

// The memory of the agent: short notes of three kinds (corrections, lessons,
// preferences) in three scopes (the person, the project, the task). Nothing
// is saved without the person. Pinned notes go into every conversation, up
// to a small budget; the rest the agent searches for.

export const NOTE_KINDS = ['correction', 'lesson', 'preference'];
export const NOTE_SCOPES = ['personal', 'project', 'task'];
export const TAG_KINDS = ['screen', 'endpoint', 'platform', 'task'];

export const MAX_NOTE = 300;
export const PINNED_BUDGET = 2000;
export const SEARCH_LIMIT = 10;
export const STALE_DAYS = 90;

// what looks like a secret, besides the masks for personal data
const SECRET_LIKE =
  /(?<![\p{L}\p{N}])(bearer\s+[\w.-]{8,}|gh[pousr]_\w{20,}|glpat-[\w-]{10,}|xox[abp]-[\w-]{10,}|AKIA[0-9A-Z]{12,}|sk-[\w-]{16,}|eyJ[\w-]{10,}\.[\w-]{10,})|(?<![\p{L}\p{N}])(password|passwd|пароль|token|токен|secret|api[_-]?key)\s*[:=]\s*\S+/iu;

const newNoteId = () => `n-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const cleanTags = (tags) =>
  Object.fromEntries(
    TAG_KINDS.map((kind) => [
      kind,
      String(tags?.[kind] ?? '')
        .trim()
        .slice(0, 120),
    ]).filter(([, value]) => value),
  );

/** A note as it is kept, whatever came in. */
export function cleanNote(note, now = new Date()) {
  return {
    id: String(note?.id ?? '') || newNoteId(),
    kind: NOTE_KINDS.includes(note?.kind) ? note.kind : 'lesson',
    scope: NOTE_SCOPES.includes(note?.scope) ? note.scope : 'project',
    text: String(note?.text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_NOTE),
    tags: cleanTags(note?.tags),
    pinned: !!note?.pinned,
    source: note?.source ?? null,
    createdAt: note?.createdAt ?? new Date(now).toISOString(),
    lastUsedAt: note?.lastUsedAt ?? null,
    uses: Number(note?.uses) || 0,
  };
}

/**
 * Whether a note may be kept: not empty, not a secret, no personal data.
 * @returns {{ok: true} | {ok: false, reason: 'empty' | 'secret' | 'personal', found?: string}}
 */
export function checkNote(text, masks = compileMasks()) {
  const value = String(text ?? '').trim();
  if (!value) {
    return {ok: false, reason: 'empty'};
  }
  const secret = SECRET_LIKE.exec(value);
  if (secret) {
    return {ok: false, reason: 'secret', found: secret[0].slice(0, 40)};
  }
  if (maskText(value, masks) !== value) {
    return {ok: false, reason: 'personal'};
  }
  return {ok: true};
}

const words = (text) =>
  new Set(
    String(text ?? '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}/._-]+/u)
      .filter((word) => word.length > 2),
  );

const overlap = (a, b) => {
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) {
    return 0;
  }
  let shared = 0;
  for (const word of left) {
    if (right.has(word)) {
      shared++;
    }
  }
  return shared / Math.min(left.size, right.size);
};

const sameTags = (a, b) => TAG_KINDS.every((kind) => (a.tags?.[kind] ?? '') === (b.tags?.[kind] ?? ''));

/** A note already kept that says nearly the same about the same things. */
export function similarNote(note, notes) {
  return notes.find((one) => one.id !== note.id && sameTags(one, note) && overlap(one.text, note.text) >= 0.6) ?? null;
}

/**
 * The notes that fit a search, best first: by the words of the query and the
 * tags (a screen, an endpoint, a platform, a task).
 */
export function searchNotes(notes, {query = '', tags = {}} = {}, limit = SEARCH_LIMIT) {
  const wanted = cleanTags(tags);
  return notes
    .map((note) => {
      let score = query ? overlap(query, `${note.text} ${Object.values(note.tags).join(' ')}`) * 2 : 0;
      for (const [kind, value] of Object.entries(wanted)) {
        const mine = note.tags?.[kind];
        if (
          mine &&
          (mine.toLowerCase().includes(value.toLowerCase()) || value.toLowerCase().includes(mine.toLowerCase()))
        ) {
          score += 3;
        }
      }
      if (note.kind === 'correction') {
        score += 0.5;
      }
      return {note, score};
    })
    .filter(({score}) => score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({note}) => note);
}

/** The pinned notes for every conversation, within the budget; corrections first. */
export function pinnedNotes(notes, budget = PINNED_BUDGET) {
  const pinned = notes
    .filter((note) => note.pinned)
    .sort((a, b) => Number(b.kind === 'correction') - Number(a.kind === 'correction'));
  const kept = [];
  let used = 0;
  for (const note of pinned) {
    if (used + note.text.length > budget) {
      break;
    }
    kept.push(note);
    used += note.text.length;
  }
  return {notes: kept, used, budget, left: pinned.length - kept.length};
}

/** Notes nobody used for a long time, to clean up. */
export function staleNotes(notes, now = new Date(), days = STALE_DAYS) {
  const limit = new Date(now).getTime() - days * 24 * 3600 * 1000;
  return notes.filter((note) => new Date(note.lastUsedAt ?? note.createdAt).getTime() < limit);
}

/** Notes from a file added to those here, without repeats. */
export function mergeNotes(existing = [], incoming = []) {
  const merged = [...existing];
  for (const raw of incoming) {
    const note = cleanNote(raw);
    if (!merged.some((one) => one.id === note.id || (sameTags(one, note) && overlap(one.text, note.text) >= 0.6))) {
      merged.push(note);
    }
  }
  return merged;
}

/** Notes as the agent reads them: one line each, with the id to refer to. */
export const notesForAgent = (notes) =>
  notes.length
    ? notes
        .map((note) => {
          const tags = Object.entries(note.tags)
            .map(([kind, value]) => `${kind}=${value}`)
            .join(', ');
          return `- ${note.id} [${note.kind}, ${note.scope}${tags ? `; ${tags}` : ''}] ${note.text}`;
        })
        .join('\n')
    : 'No notes fit.';
