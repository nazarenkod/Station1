// Based on vision (backend/src/a11y/a11y-issues.ts): the same decisions, kept on this machine
// instead of a server, per app and screen.

import type {A11yViolation} from './types';

export type A11yIssueStatus = 'reported' | 'ignored';

export interface A11yIssueState {
  appId: string;
  screenKey: string;
  screenTitle: string | null;
  violationId: string;
  status: A11yIssueStatus;
  jiraKey?: string | null;
  jiraUrl?: string | null;
  comment?: string | null;
  // what the issue was, so the list of decisions makes sense on its own
  rule: string;
  element: string;
  at: string;
}

export type A11yIssueStore = Record<string, A11yIssueState>;

export const issueKey = (appId: string, screenKey: string, violationId: string) =>
  `${appId}::${screenKey}::${violationId}`;

export type ReviewedViolation = A11yViolation & {issue?: A11yIssueState};

export interface ReviewedScan {
  // issues nobody has acted on, then the filed ones
  open: ReviewedViolation[];
  reported: ReviewedViolation[];
  ignored: ReviewedViolation[];
  // bugs filed for this screen whose issue is no longer found: they can be closed
  resolved: A11yIssueState[];
  summary: {open: number; reported: number; ignored: number; resolved: number; errors: number; warnings: number};
}

/**
 * Applies the decisions stored for this app and screen to the issues found now.
 */
export function reviewScan(
  violations: A11yViolation[],
  store: A11yIssueStore,
  appId: string,
  screenKey: string,
): ReviewedScan {
  const open: ReviewedViolation[] = [];
  const reported: ReviewedViolation[] = [];
  const ignored: ReviewedViolation[] = [];
  for (const violation of violations) {
    const issue = store[issueKey(appId, screenKey, violation.id)];
    if (!issue) {
      open.push(violation);
    } else {
      (issue.status === 'ignored' ? ignored : reported).push({...violation, issue});
    }
  }
  const present = new Set(violations.map((v) => v.id));
  const resolved = Object.values(store).filter(
    (state) =>
      state.appId === appId &&
      state.screenKey === screenKey &&
      state.status === 'reported' &&
      !present.has(state.violationId),
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
      errors: open.filter((v) => v.severity === 'error').length,
      warnings: open.filter((v) => v.severity === 'warning').length,
    },
  };
}

export function recordDecision(
  store: A11yIssueStore,
  state: Omit<A11yIssueState, 'at'> & {at?: string},
): A11yIssueStore {
  return {
    ...store,
    [issueKey(state.appId, state.screenKey, state.violationId)]: {...state, at: state.at ?? new Date().toISOString()},
  };
}

export function forgetDecision(store: A11yIssueStore, appId: string, screenKey: string, violationId: string) {
  const next = {...store};
  delete next[issueKey(appId, screenKey, violationId)];
  return next;
}

/**
 * Merges decisions exported elsewhere; on both sides the newer decision wins.
 */
export function importDecisions(store: A11yIssueStore, imported: unknown): A11yIssueStore {
  if (!imported || typeof imported !== 'object') {
    return store;
  }
  const next = {...store};
  for (const state of Object.values(imported as Record<string, A11yIssueState>)) {
    if (!state?.appId || !state.screenKey || !state.violationId || !['reported', 'ignored'].includes(state.status)) {
      continue;
    }
    const key = issueKey(state.appId, state.screenKey, state.violationId);
    if (!next[key] || (state.at ?? '') > (next[key].at ?? '')) {
      next[key] = state;
    }
  }
  return next;
}
