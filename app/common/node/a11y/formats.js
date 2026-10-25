import en from '../../public/locales/en/translation.json';
import {violationText} from '../../renderer/components/SessionInspector/A11yTab/a11y-ui.js';
import {buildHtmlReport} from '../../renderer/components/SessionInspector/A11yTab/html-report.js';

const escapeXml = (text) =>
  String(text ?? '').replace(
    /[&<>"']/g,
    (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'})[c],
  );

/**
 * English texts for reports made outside the app, with i18next-style {{params}}.
 */
export function t(key, params = {}) {
  const template = en[key] ?? params.defaultValue ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => (params[name] ?? `{{${name}}}`).toString());
}

const score = (reviewed) => {
  const penalty = {error: 12, warning: 5, info: 1};
  const weight = [...reviewed.open, ...reviewed.reported].reduce(
    (sum, group) => sum + (penalty[group.severity] ?? 0),
    0,
  );
  return Math.max(0, 100 - weight);
};

const problemJson = (group) => ({
  code: group.code,
  rule: group.rule,
  severity: group.severity,
  component: group.component,
  everyScreen: group.everyScreen,
  ...(group.problemClass ? {problemClass: group.problemClass} : {}),
  title: violationText(t, group.violations[0]).title,
  elements: group.violations.map((v) => ({
    message: violationText(t, v).message,
    resourceId: v.resourceId,
    className: v.className,
    label: v.label,
    bounds: v.bounds,
    details: v.details,
  })),
  fix: violationText(t, group.violations[0]).fix,
});

export function toJson({scan, screen, reviewed, appId}) {
  return JSON.stringify(
    {
      screen,
      appId,
      score: score(reviewed),
      summary: reviewed.summary,
      problems: reviewed.open.map(problemJson),
      reported: reviewed.reported.map((group) => ({
        code: group.code,
        rule: group.rule,
        jiraKey: group.issue?.jiraKey ?? null,
      })),
      ignored: reviewed.ignored.map((group) => ({
        code: group.code,
        rule: group.rule,
        comment: group.issue?.comment ?? null,
      })),
      resolved: reviewed.resolved.map((problem) => ({code: problem.code, jiraKey: problem.jiraKey})),
      readingOrder: scan.readingOrder,
    },
    null,
    2,
  );
}

const SEVERITY_MARK = {error: '✖', warning: '▲', info: '•'};

export function toText({screen, reviewed, appId}) {
  const lines = [
    `${screen.title ?? 'Untitled screen'} (${appId}) — score ${score(reviewed)}`,
    `${reviewed.summary.errors} error(s), ${reviewed.summary.warnings} warning(s), ${reviewed.open.length} open problem(s), ${reviewed.summary.reported} filed, ${reviewed.summary.ignored} ignored`,
    '',
  ];
  for (const group of reviewed.open) {
    const {title} = violationText(t, group.violations[0]);
    lines.push(
      `${SEVERITY_MARK[group.severity]} ${title} [${group.rule}] ${group.code}${group.component ? ` (${group.component})` : ''}`,
      ...group.violations.map((v) => `    ${violationText(t, v).message}`),
    );
  }
  return lines.join('\n');
}

/**
 * JUnit XML: one test case per rule, failing with the open problems it found,
 * so CI shows accessibility next to the other tests.
 */
export function toJunit({screen, reviewed, appId}, rules) {
  const suite = escapeXml(`a11y: ${screen.title ?? screen.key}`);
  const byRule = new Map();
  for (const group of reviewed.open) {
    byRule.set(group.rule, [...(byRule.get(group.rule) ?? []), group]);
  }
  const cases = rules.map((rule) => {
    const found = (byRule.get(rule) ?? []).filter((group) => group.severity !== 'info');
    if (!found.length) {
      return `    <testcase classname="${suite}" name="${rule}"/>`;
    }
    const body = found
      .map((group) => `${group.code}: ${group.violations.map((v) => violationText(t, v).message).join(' ')}`)
      .join('\n');
    return `    <testcase classname="${suite}" name="${rule}">\n      <failure message="${found.length} problem(s)">${escapeXml(body)}</failure>\n    </testcase>`;
  });
  const failures = cases.filter((c) => c.includes('<failure')).length;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="Vision Inspector">`,
    `  <testsuite name="${suite}" tests="${rules.length}" failures="${failures}" hostname="${escapeXml(appId)}">`,
    ...cases,
    '  </testsuite>',
    '</testsuites>',
  ].join('\n');
}

export function toHtml({scan, screen, reviewed, appId}, png) {
  return buildHtmlReport({
    t,
    scan,
    reviewed,
    screen,
    device: {appId},
    screenshot: png ? png.toString('base64') : null,
    score: score(reviewed),
  });
}
