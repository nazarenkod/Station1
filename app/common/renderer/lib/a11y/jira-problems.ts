// How a problem's bugs are found in Jira. Ported from vision (A11yIssuesService: jqlFor, isBugOf,
// codeOn): keep in sync until both use a shared package.

import {unlinkedLabel} from './problems';

// labels every accessibility bug carries, besides the problem's markers
export const BUG_LABELS = ['accessibility', 'vision'];
export const CODE_LABEL = /^a11y-[0-9a-f]{8}$/;
// a problem looked up in Jira is not looked up again for this long
export const JIRA_LOOKUP_TTL_MS = 10 * 60 * 1000;
// problems per search request
export const JIRA_LOOKUP_BATCH = 15;

/** An issue found by a search, with whether it is still open. */
export interface FoundIssue {
  key: string;
  url: string;
  summary: string;
  status: string;
  // the status category is Done
  done: boolean;
  labels: string[];
}

/** The JQL that finds bugs of a problem: its id as a label or in the summary, or its markers. */
export function jqlFor(code: string, markers: string[] | null): string {
  return [
    `labels = "${code}"`,
    `summary ~ "\\"${code}\\""`,
    ...(markers ? [`(${markers.map((label) => `labels = "${label}"`).join(' AND ')})`] : []),
  ].join(' OR ');
}

/** Whether a found issue is an open bug of the problem: by its id, or by all of its markers. */
export function isBugOf(issue: FoundIssue, code: string, markers: string[] | null): boolean {
  if (issue.done || issue.labels.includes(unlinkedLabel(code))) {
    return false;
  }
  if (issue.labels.includes(code) || issue.summary.includes(code)) {
    return true;
  }
  return !!markers && markers.every((label) => issue.labels.includes(label));
}

/** The id a found bug already carries, so a problem found in Jira keeps it. */
export function codeOn(issue: FoundIssue): string | null {
  return (
    issue.labels.find((label) => CODE_LABEL.test(label)) ?? /\[(a11y-[0-9a-f]{8})\]/.exec(issue.summary)?.[1] ?? null
  );
}
