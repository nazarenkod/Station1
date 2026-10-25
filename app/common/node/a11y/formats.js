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
  const weight = [...reviewed.open, ...reviewed.reported].reduce((sum, v) => sum + (penalty[v.severity] ?? 0), 0);
  return Math.max(0, 100 - weight);
};

export function toJson({scan, screen, reviewed, appId}) {
  return JSON.stringify(
    {
      screen,
      appId,
      score: score(reviewed),
      summary: reviewed.summary,
      issues: reviewed.open.map((v) => ({...v, ...violationText(t, v)})),
      reported: reviewed.reported.map((v) => ({id: v.id, rule: v.rule, jiraKey: v.issue?.jiraKey ?? null})),
      ignored: reviewed.ignored.map((v) => ({id: v.id, rule: v.rule, comment: v.issue?.comment ?? null})),
      resolved: reviewed.resolved,
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
    `${reviewed.summary.errors} error(s), ${reviewed.summary.warnings} warning(s), ${reviewed.open.length} open, ${reviewed.summary.reported} filed, ${reviewed.summary.ignored} ignored`,
    '',
  ];
  for (const v of reviewed.open) {
    const {title, message} = violationText(t, v);
    lines.push(`${SEVERITY_MARK[v.severity]} ${title} [${v.rule}]`, `    ${message}`);
  }
  return lines.join('\n');
}

/**
 * JUnit XML: one test case per rule, failing with the open issues it found,
 * so CI shows accessibility next to the other tests.
 */
export function toJunit({screen, reviewed, appId}, rules) {
  const suite = escapeXml(`a11y: ${screen.title ?? screen.key}`);
  const byRule = new Map();
  for (const v of reviewed.open) {
    byRule.set(v.rule, [...(byRule.get(v.rule) ?? []), v]);
  }
  const cases = rules.map((rule) => {
    const found = (byRule.get(rule) ?? []).filter((v) => v.severity !== 'info');
    if (!found.length) {
      return `    <testcase classname="${suite}" name="${rule}"/>`;
    }
    const body = found.map((v) => violationText(t, v).message).join('\n');
    return `    <testcase classname="${suite}" name="${rule}">\n      <failure message="${found.length} issue(s)">${escapeXml(body)}</failure>\n    </testcase>`;
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
