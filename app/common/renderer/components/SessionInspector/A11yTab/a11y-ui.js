// How accessibility issues read and weigh in the UI

import {mergeConfig} from '../../../lib/a11y/config';
import {asStore, problemContextOf, reviewScan} from '../../../lib/a11y/issues';

const PENALTY = {error: 12, warning: 5, info: 1};

/**
 * A 0–100 score for the screen: every issue not ignored costs points by its severity.
 */
export function a11yScore(violations) {
  const penalty = violations.reduce((sum, v) => sum + (PENALTY[v.severity] ?? 0), 0);
  return Math.max(0, 100 - penalty);
}

export const scoreTone = (score) => (score >= 90 ? 'good' : score >= 60 ? 'fair' : 'poor');

const messageKey = (violation) =>
  violation.rule === 'non-descriptive-label'
    ? `a11yMsg_${violation.rule}_${violation.details?.reason ?? 'code'}`
    : `a11yMsg_${violation.rule}`;

/**
 * The issue's title, message and fix in the UI language; the rule's own
 * English text when a translation is missing (AI issues bring their own).
 */
export function violationText(t, violation) {
  const params = {...violation.details, interpolation: {escapeValue: false}};
  if (violation.source === 'ai') {
    return {title: violation.title, message: violation.message, fix: violation.details?.fix ?? ''};
  }
  return {
    title: t(`a11yRule_${violation.rule}`, {defaultValue: violation.title}),
    message: t(messageKey(violation), {...params, defaultValue: violation.message}),
    fix: t(`a11yFix_${violation.rule}`, {defaultValue: ''}),
  };
}

/**
 * Plain-text summary of a problem to paste into a chat or a bug.
 */
export function problemAsText(t, group, screen) {
  const {title, fix} = violationText(t, group.violations[0]);
  return [
    `[A11y] ${screen?.title ? `${screen.title}: ` : ''}${title} [${group.code}]`,
    ...group.violations.map((v) => violationText(t, v).message),
    ...group.violations.map((v) => (v.resourceId ? `id: ${v.resourceId}` : `class: ${v.className}`)),
    fix ? `${t('a11yHowToFix')}: ${fix}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The screen's problems with the team's decisions applied, and the ones the
 * current filter shows. The list and the screenshot overlay show the same.
 */
export function visibleIssues({a11yScan, a11yScreen, a11yDevice, a11yIssues, a11yFilter, a11yAi, a11yConfig}) {
  if (!a11yScan || !a11yScreen || !a11yDevice) {
    return {reviewed: null, visible: [], context: null};
  }
  // the model's findings and suggested labels belong to the screen they were asked about
  const ai = a11yAi?.status === 'done' && a11yAi.screenKey === a11yScreen.key ? a11yAi : null;
  const violations = [
    ...a11yScan.violations.map((v) =>
      ai?.labels?.[v.id] ? {...v, details: {...v.details, suggestedLabel: ai.labels[v.id]}} : v,
    ),
    ...(ai?.violations ?? []),
  ];
  const context = problemContextOf({
    config: a11yConfig ?? mergeConfig(null),
    appId: a11yDevice.appId,
    screen: a11yScreen,
  });
  const reviewed = reviewScan(violations, asStore(a11yIssues), context);
  const byStatus = {open: reviewed.open, reported: reviewed.reported, ignored: reviewed.ignored, resolved: []};
  const visible = (byStatus[a11yFilter.status] ?? []).filter(
    (group) =>
      (a11yFilter.severity === 'all' || group.severity === a11yFilter.severity) &&
      (a11yFilter.rule === 'all' || group.rule === a11yFilter.rule),
  );
  return {reviewed, visible, context};
}

/**
 * A problem's score weight, like an issue's: every problem not ignored counts once.
 */
export const problemsForScore = (reviewed) => [...(reviewed?.open ?? []), ...(reviewed?.reported ?? [])];
