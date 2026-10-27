import {stableHash} from '../findings/findings.js';

// The impact analysis as a checklist: what to check in the task's changes
// and what could regress around them. The agent hands it over structured;
// the station keeps out what would be noise (no evidence, a repeat, general
// advice), so what the person sees is worth checking.

export const SECTIONS = ['check', 'regress'];

// advice that fits any task says nothing about this one
const GENERIC = [
  /перевір(те|ити)?\s+(всі|усі|весь)\s+(екрани|застосунок|функціонал)/i,
  /(повн(ий|е)|загальн(ий|е))\s+регрес/i,
  /^провест[иь]\s+регрес/i,
  /\b(test|check|verify)\s+(all|every)\s+(screens?|flows?|features?|the app)\b/i,
  /\b(full|complete|general)\s+regression\b/i,
  /^(do|run|perform)\s+(a\s+)?regression\b/i,
  /\bsmoke\s+test\s+(the\s+)?(whole\s+)?app\b/i,
];

const MAX_TEXT = 200;

const normalize = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/._-]+/gu, ' ')
    .trim();

/** The id of a check: the same text keeps its id, so its tick survives a re-run. */
export const itemId = (section, text) => `${section}-${stableHash(normalize(text))}`;

const cleanEvidence = (list) =>
  (Array.isArray(list) ? list : [])
    .map((one) => ({
      file: one?.file ? String(one.file).slice(0, 300) : undefined,
      lines: one?.lines ? String(one.lines).slice(0, 40) : undefined,
      commit: one?.commit ? String(one.commit).slice(0, 40) : undefined,
      mr: one?.mr ? String(one.mr).slice(0, 300) : undefined,
      note: one?.note ? String(one.note).slice(0, 300) : undefined,
    }))
    .filter((one) => one.file || one.commit || one.mr);

/**
 * The checklist the station keeps, and what it left out and why, for the
 * agent to fix and send again.
 * @param {{check?: object[], regress?: object[], empty?: {check?: string, regress?: string}}} report
 * @returns {{items: object[], empty: object, rejected: {text: string, reason: string}[]}}
 */
export function validateImpact(report) {
  const items = [];
  const rejected = [];
  const seen = new Set();
  for (const section of SECTIONS) {
    for (const raw of Array.isArray(report?.[section]) ? report[section] : []) {
      const text = String(raw?.text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) {
        continue;
      }
      const evidence = cleanEvidence(raw.evidence);
      const id = itemId(section, text);
      if (!evidence.length) {
        rejected.push({text, reason: 'no evidence: give a file and lines of the diff, a commit or a usage site'});
      } else if (GENERIC.some((pattern) => pattern.test(text))) {
        rejected.push({text, reason: 'general advice: say what exactly to check here'});
      } else if (seen.has(normalize(text))) {
        rejected.push({text, reason: 'repeats another check'});
      } else {
        seen.add(normalize(text));
        items.push({
          id,
          section,
          text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text,
          important: !!raw.important,
          why: raw.why ? String(raw.why).slice(0, 600) : undefined,
          evidence,
        });
      }
    }
  }
  // important ones first, the order of the agent kept otherwise
  items.sort(
    (a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || Number(b.important) - Number(a.important),
  );
  const empty = Object.fromEntries(
    SECTIONS.filter((section) => !items.some((item) => item.section === section) && report?.empty?.[section]).map(
      (section) => [section, String(report.empty[section]).slice(0, 200)],
    ),
  );
  return {items, empty, rejected};
}

/** What a re-run added and removed, by the ids of the checks. */
export function impactChanges(before, after) {
  const was = new Set((before ?? []).map((item) => item.id));
  const now = new Set((after ?? []).map((item) => item.id));
  return {
    added: (after ?? []).filter((item) => !was.has(item.id)).map((item) => item.id),
    removed: (before ?? [])
      .filter((item) => !now.has(item.id))
      .map((item) => ({id: item.id, text: item.text, section: item.section})),
  };
}

/**
 * Whether a saved analysis no longer fits the task: a merge request moved on,
 * a new one appeared, or the task changed after it.
 */
export function impactStale(impact, context) {
  if (!impact || !context) {
    return false;
  }
  const mrs = context.mrs ?? [];
  const saved = new Map((impact.mrVersions ?? []).map((one) => [one.url, one.sha]));
  if (mrs.some((mr) => mr.sha && saved.get(mr.url) !== mr.sha)) {
    return true;
  }
  const updated = context.task?.updated ? Date.parse(context.task.updated) : 0;
  return updated > Date.parse(impact.at ?? 0);
}

/** A line for the chat: how many checks and risks. */
export const impactCounts = (items) => ({
  check: items.filter((item) => item.section === 'check').length,
  regress: items.filter((item) => item.section === 'regress').length,
});
