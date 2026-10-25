// Decisions about accessibility problems, kept on this machine. The logic is vision's
// (a11y-issues.ts reviewReport, A11yIssuesService decide/reset): problems are created once with an
// id and the facts of their occurrences, and what is one problem is worked out from the facts under
// the current settings. Vision keeps them in its database; Vision Inspector keeps them locally and
// learns about the rest of the team from Jira (see jira-problems.ts).

import {
  classOf,
  facetsFromKey,
  facetsOf,
  isComponentProblem,
  problemCode,
  problemKeyOf,
  type ProblemFacets,
  type ProblemSettings,
  readingOf,
} from './problems';
import type {A11ySeverity, A11yViolation} from './types';

export type ProblemStatus = 'reported' | 'ignored';
export type DecisionAction = 'filed' | 'linked' | 'found' | 'unlinked' | 'ignored' | 'restored';

export interface StoredProblem {
  // the project the id was made for (the app, or vision's project to share ids with it)
  projectId: string;
  code: string;
  // what the problem was when it was created; it is told by its facts afterwards
  key: string;
  facets: ProblemFacets[];
  status: ProblemStatus;
  jiraKey: string | null;
  jiraUrl: string | null;
  comment: string | null;
  // the screen it was decided on
  screen: string;
  screenTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionLogEntry {
  projectId: string;
  code: string;
  action: DecisionAction;
  jiraKey?: string | null;
  screen: string;
  comment?: string | null;
  at: string;
}

export interface A11yStore {
  version: 2;
  problems: StoredProblem[];
  log: DecisionLogEntry[];
}

// the decision log is kept for export and history, not forever
const MAX_LOG = 2000;

export const emptyStore = (): A11yStore => ({version: 2, problems: [], log: []});

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * A saved store, or one from before problems had ids (a decision per issue,
 * keyed app::screen::rule|element), turned into problems.
 */
export function asStore(saved: unknown): A11yStore {
  if (isObject(saved) && saved.version === 2 && Array.isArray(saved.problems)) {
    return {version: 2, problems: saved.problems as StoredProblem[], log: (saved.log as DecisionLogEntry[]) ?? []};
  }
  const store = emptyStore();
  if (!isObject(saved)) {
    return store;
  }
  for (const old of Object.values(saved)) {
    if (
      !isObject(old) ||
      typeof old.violationId !== 'string' ||
      !['reported', 'ignored'].includes(old.status as string)
    ) {
      continue;
    }
    const separator = old.violationId.indexOf('|');
    const rule = old.violationId.slice(0, separator);
    const nodeKey = old.violationId.slice(separator + 1);
    const screen = (old.screenTitle as string) || (old.screenKey as string);
    const facets = facetsOf({rule: rule as never, nodeKey}, screen);
    const key = problemKeyOf(facets);
    const projectId = old.appId as string;
    store.problems.push({
      projectId,
      code: problemCode(projectId, key),
      key,
      facets: [facets],
      status: old.status as ProblemStatus,
      jiraKey: (old.jiraKey as string) ?? null,
      jiraUrl: (old.jiraUrl as string) ?? null,
      comment: (old.comment as string) ?? null,
      screen,
      screenTitle: (old.screenTitle as string) ?? null,
      createdAt: (old.at as string) ?? new Date(0).toISOString(),
      updatedAt: (old.at as string) ?? new Date(0).toISOString(),
    });
  }
  return store;
}

const idOf = (problem: Pick<StoredProblem, 'projectId' | 'code'>) => `${problem.projectId}\n${problem.code}`;

const storedFacets = (problem: StoredProblem) =>
  problem.facets?.length ? problem.facets : [facetsFromKey(problem.key)];

const dedupeFacets = (facets: ProblemFacets[]): ProblemFacets[] => [
  ...new Map(facets.map((item) => [`${item.nodeKey}\n${item.screen}\n${item.measure}`, item])).values(),
];

export type ProblemIndex = Map<string, StoredProblem[]>;

/**
 * Stored problems of the project by what each of their occurrences is under
 * the given settings: settings that see two problems as one put both under
 * one key; settings that split one put it under several.
 */
export function indexProblems(
  problems: StoredProblem[],
  projectId: string,
  settings: ProblemSettings = {},
): ProblemIndex {
  const index: ProblemIndex = new Map();
  for (const problem of problems) {
    if (problem.projectId !== projectId) {
      continue;
    }
    for (const key of new Set(storedFacets(problem).map((facets) => problemKeyOf(facets, settings)))) {
      index.set(key, [...(index.get(key) ?? []), problem]);
    }
  }
  return index;
}

/** The problem that decides for an issue among those matching it: one of this screen, else the oldest. */
export function decidingProblem(matching: StoredProblem[], screen: string): StoredProblem | undefined {
  return [...matching].sort(
    (a, b) => Number(b.screen === screen) - Number(a.screen === screen) || a.createdAt.localeCompare(b.createdAt),
  )[0];
}

export interface ProblemIssue {
  status: ProblemStatus;
  jiraKey?: string | null;
  jiraUrl?: string | null;
  comment?: string | null;
  // decided on another screen: a component's problem holds on every screen
  decidedOn?: string;
  // ignored by the project's problem class of this name, not by a decision
  byClass?: string;
  // other bugs of the same problem, when the settings now see several problems as one
  related?: Array<{code: string; jiraKey: string | null; jiraUrl: string | null}>;
}

/** One problem on the screen: the issues it takes, and what was decided about it. */
export interface ProblemGroup {
  key: string;
  code: string;
  component: string | null;
  everyScreen: boolean;
  problemClass?: string;
  rule: string;
  severity: A11ySeverity;
  violations: A11yViolation[];
  facets: ProblemFacets[];
  matching: StoredProblem[];
  deciding?: StoredProblem;
  issue?: ProblemIssue;
}

export interface ReviewContext {
  projectId: string;
  // the screen's identity: its title, else what recognised it
  screen: string;
  screenTitle: string | null;
  settings?: ProblemSettings;
}

export interface ReviewedScan {
  open: ProblemGroup[];
  reported: ProblemGroup[];
  ignored: ProblemGroup[];
  // problems filed from this screen that it no longer has: their bugs can be closed
  resolved: StoredProblem[];
  summary: {open: number; reported: number; ignored: number; resolved: number; errors: number; warnings: number};
}

const SEVERITY_ORDER: Record<A11ySeverity, number> = {error: 0, warning: 1, info: 2};

/**
 * The screen's issues as problems with the team's decisions applied. A
 * problem filed or ignored anywhere covers it on every screen it shows on,
 * and keeps its id whatever the settings become.
 */
export function reviewScan(violations: A11yViolation[], store: A11yStore, context: ReviewContext): ReviewedScan {
  const settings = context.settings ?? {};
  const index = indexProblems(store.problems, context.projectId, settings);
  const groups = new Map<string, ProblemGroup>();
  const matched = new Set<StoredProblem>();
  for (const violation of violations) {
    const facets = facetsOf(violation, context.screen);
    const key = problemKeyOf(facets, settings);
    const existing = groups.get(key);
    if (existing) {
      existing.violations.push(violation);
      existing.facets.push(facets);
      if (SEVERITY_ORDER[violation.severity] < SEVERITY_ORDER[existing.severity]) {
        existing.severity = violation.severity;
      }
      continue;
    }
    const matching = index.get(key) ?? [];
    matching.forEach((problem) => matched.add(problem));
    const deciding = decidingProblem(matching, context.screen);
    const {problemClass, component} = readingOf(facets, settings);
    const taken = classOf(facets, settings.classes);
    let issue: ProblemIssue | undefined;
    if (deciding) {
      const related = matching
        .filter((other) => other !== deciding && other.status === 'reported')
        .map((other) => ({code: other.code, jiraKey: other.jiraKey, jiraUrl: other.jiraUrl}));
      issue = {
        status: deciding.status,
        jiraKey: deciding.jiraKey,
        jiraUrl: deciding.jiraUrl,
        comment: deciding.comment,
        ...(deciding.screen !== context.screen ? {decidedOn: deciding.screenTitle || deciding.screen} : {}),
        ...(related.length ? {related} : {}),
      };
    } else if (taken?.problemClass.action === 'ignore') {
      issue = {status: 'ignored', comment: `Class “${taken.problemClass.name}”`, byClass: taken.problemClass.name};
    }
    groups.set(key, {
      key,
      code: deciding?.code ?? problemCode(context.projectId, key),
      component,
      everyScreen: isComponentProblem(key),
      ...(problemClass ? {problemClass: problemClass.name} : {}),
      rule: violation.rule,
      severity: violation.severity,
      violations: [violation],
      facets: [facets],
      matching,
      ...(deciding ? {deciding} : {}),
      ...(issue ? {issue} : {}),
    });
  }
  const sorted = [...groups.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.violations[0].bounds.y - b.violations[0].bounds.y ||
      a.violations[0].bounds.x - b.violations[0].bounds.x,
  );
  const open = sorted.filter((group) => !group.issue);
  const reported = sorted.filter((group) => group.issue?.status === 'reported');
  const ignored = sorted.filter((group) => group.issue?.status === 'ignored');
  const resolved = store.problems.filter(
    (problem) =>
      problem.projectId === context.projectId &&
      problem.screen === context.screen &&
      problem.status === 'reported' &&
      !matched.has(problem),
  );
  return {
    open,
    reported,
    ignored,
    resolved,
    summary: {
      open: open.length,
      reported: reported.length,
      ignored: ignored.length,
      resolved: resolved.length,
      // advice (severity info) is shown but not counted
      errors: open.filter((group) => group.severity === 'error').length,
      warnings: open.filter((group) => group.severity === 'warning').length,
    },
  };
}

const log = (store: A11yStore, entry: Omit<DecisionLogEntry, 'at'>): DecisionLogEntry[] =>
  [...store.log, {...entry, at: new Date().toISOString()}].slice(-MAX_LOG);

/**
 * Records a decision on a problem for the whole project: on the stored
 * problems it matches (which take the new facts too), or on a new problem.
 */
export function decide(
  store: A11yStore,
  group: ProblemGroup,
  decision: {
    status: ProblemStatus;
    jiraKey?: string | null;
    jiraUrl?: string | null;
    comment?: string | null;
    code?: string;
  },
  action: DecisionAction,
  context: ReviewContext,
): A11yStore {
  const now = new Date().toISOString();
  const fields = {
    status: decision.status,
    jiraKey: decision.jiraKey ?? null,
    jiraUrl: decision.jiraUrl ?? null,
    comment: decision.comment ?? null,
    screen: context.screen,
    screenTitle: context.screenTitle,
    updatedAt: now,
  };
  let problems: StoredProblem[];
  let codes: string[];
  if (group.matching.length) {
    const ids = new Set(group.matching.map(idOf));
    problems = store.problems.map((problem) =>
      ids.has(idOf(problem))
        ? {...problem, ...fields, facets: dedupeFacets([...storedFacets(problem), ...group.facets])}
        : problem,
    );
    codes = group.matching.map((problem) => problem.code);
  } else {
    const code = decision.code ?? group.code;
    problems = [
      ...store.problems,
      {
        projectId: context.projectId,
        code,
        key: group.key,
        facets: dedupeFacets(group.facets),
        createdAt: now,
        ...fields,
      },
    ];
    codes = [code];
  }
  let next: A11yStore = {...store, problems};
  for (const code of codes) {
    next = {
      ...next,
      log: log(next, {
        projectId: context.projectId,
        code,
        action,
        jiraKey: fields.jiraKey,
        screen: context.screen,
        comment: fields.comment,
      }),
    };
  }
  return next;
}

/**
 * Forgets the decision on a problem (undo of ignore or of a link), on every
 * screen. Parts of a stored problem the settings now see as other problems
 * keep it. Returns the bugs to take Vision's markers off in Jira.
 */
export function forget(
  store: A11yStore,
  group: ProblemGroup,
  context: ReviewContext,
): {store: A11yStore; unlinked: Array<{jiraKey: string; code: string}>} {
  const settings = context.settings ?? {};
  const touched = new Set(group.matching.map(idOf));
  const unlinked: Array<{jiraKey: string; code: string}> = [];
  let next: A11yStore = store;
  const problems: StoredProblem[] = [];
  for (const problem of store.problems) {
    if (!touched.has(idOf(problem))) {
      problems.push(problem);
      continue;
    }
    const remaining = storedFacets(problem).filter((facets) => problemKeyOf(facets, settings) !== group.key);
    const action: DecisionAction = problem.status === 'ignored' ? 'restored' : 'unlinked';
    next = {
      ...next,
      log: log(next, {
        projectId: problem.projectId,
        code: problem.code,
        action,
        jiraKey: problem.jiraKey,
        screen: context.screen,
        comment: remaining.length ? 'Part of the problem; the rest keeps the decision' : null,
      }),
    };
    if (remaining.length) {
      problems.push({...problem, facets: remaining, updatedAt: new Date().toISOString()});
    } else if (problem.status === 'reported' && problem.jiraKey) {
      unlinked.push({jiraKey: problem.jiraKey, code: problem.code});
    }
  }
  return {store: {...next, problems}, unlinked};
}

/**
 * Merges decisions exported from another Vision Inspector: problems by id,
 * the newer decision winning; logs are joined.
 */
export function importStore(store: A11yStore, imported: unknown): A11yStore {
  const other = asStore(imported);
  const byCode = new Map(store.problems.map((problem) => [idOf(problem), problem]));
  for (const problem of other.problems) {
    if (!problem?.code || !problem.projectId || !['reported', 'ignored'].includes(problem.status)) {
      continue;
    }
    const key = idOf(problem);
    const mine = byCode.get(key);
    if (!mine || problem.updatedAt > mine.updatedAt) {
      byCode.set(key, problem);
    }
  }
  const seen = new Set(store.log.map((entry) => `${entry.code}\n${entry.action}\n${entry.at}`));
  const log = [...store.log, ...other.log.filter((entry) => !seen.has(`${entry.code}\n${entry.action}\n${entry.at}`))]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-MAX_LOG);
  return {version: 2, problems: [...byCode.values()], log};
}

/** Which problems of the screen to look up in Jira: open ones not looked up lately. */
export function lookupCandidates(open: ProblemGroup[], lookedUp: Record<string, number>, now = Date.now(), ttl = 0) {
  return open.filter((group) => !(lookedUp[group.code] && now - lookedUp[group.code] < ttl));
}

/**
 * Where the screen's problems are decided: the project the ids are made for
 * (the app unless vision's project is set), the screen by its title, and the
 * settings of what is one problem.
 */
export function problemContextOf(input: {
  config: {
    problems: {
      projectId: string;
      duplicateModes: ProblemSettings['duplicateModes'];
      classes: ProblemSettings['classes'];
    };
  };
  appId: string;
  screen: {title: string | null; key: string};
}): ReviewContext {
  return {
    projectId: input.config.problems.projectId || input.appId,
    screen: input.screen.title ?? input.screen.key,
    screenTitle: input.screen.title,
    settings: {duplicateModes: input.config.problems.duplicateModes, classes: input.config.problems.classes},
  };
}

/**
 * Bugs whose latest decision is an unlink: no lookup links them to their problem again
 * (vision reads the same from its decision log).
 */
export function unlinkedKeys(store: A11yStore): string[] {
  const latest = new Map<string, DecisionAction>();
  for (const entry of store.log) {
    if (entry.jiraKey && ['filed', 'linked', 'found', 'unlinked'].includes(entry.action)) {
      latest.set(entry.jiraKey, entry.action);
    }
  }
  return [...latest].filter(([, action]) => action === 'unlinked').map(([key]) => key);
}
