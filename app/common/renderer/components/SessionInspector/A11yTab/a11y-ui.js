// How accessibility issues read and weigh in the UI

import {reviewScan} from '../../../lib/a11y/issues';

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
 * Plain-text summary of an issue to paste into a chat or a bug.
 */
export function violationAsText(t, violation, screen) {
  const {title, message, fix} = violationText(t, violation);
  return [
    `[A11y] ${screen?.title ? `${screen.title}: ` : ''}${title}`,
    message,
    violation.resourceId ? `id: ${violation.resourceId}` : `class: ${violation.className}`,
    fix ? `${t('a11yHowToFix')}: ${fix}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The scan with the team's decisions applied, and the issues the current
 * filter shows. The list and the screenshot overlay show the same ones.
 */
export function visibleIssues({a11yScan, a11yScreen, a11yDevice, a11yIssues, a11yFilter, a11yAi}) {
  if (!a11yScan || !a11yScreen || !a11yDevice) {
    return {reviewed: null, visible: []};
  }
  // the model's findings and suggested labels belong to the screen they were asked about
  const ai = a11yAi?.status === 'done' && a11yAi.screenKey === a11yScreen.key ? a11yAi : null;
  const violations = [
    ...a11yScan.violations.map((v) =>
      ai?.labels?.[v.id] ? {...v, details: {...v.details, suggestedLabel: ai.labels[v.id]}} : v,
    ),
    ...(ai?.violations ?? []),
  ];
  const reviewed = reviewScan(violations, a11yIssues ?? {}, a11yDevice.appId, a11yScreen.key);
  const byStatus = {open: reviewed.open, reported: reviewed.reported, ignored: reviewed.ignored, resolved: []};
  const visible = (byStatus[a11yFilter.status] ?? []).filter(
    (v) =>
      (a11yFilter.severity === 'all' || v.severity === a11yFilter.severity) &&
      (a11yFilter.rule === 'all' || v.rule === a11yFilter.rule),
  );
  return {reviewed, visible};
}
