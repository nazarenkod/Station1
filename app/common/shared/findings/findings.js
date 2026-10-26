// A finding is what any tool of the workstation reports: a broken rule about
// a subject (a component, a request, a log line), with how bad it is. Its id
// stays the same for the same rule and subject, so it can be matched with a
// bug later. Texts live in the translations: finding_<rule>_title, _why, _fix.

export const SEVERITIES = ['high', 'medium', 'low', 'info'];

export const severityRank = (severity) => {
  const index = SEVERITIES.indexOf(severity);
  return index < 0 ? SEVERITIES.length : index;
};

// FNV-1a, 32 bits: short stable ids, the same in the app, the CLI and the tests
export function stableHash(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * @param {object} finding
 * @param {string} finding.tool which tool found it: builds, proxy, logs
 * @param {string} finding.rule the rule id
 * @param {string} finding.severity high, medium, low or info
 * @param {string} finding.subject what it is about, unique within the rule
 * @param {object} [finding.params] values for the texts
 * @param {string[]} [finding.evidence] lines that show it
 * @param {string} [finding.scope] where the id is unique, e.g. the app id
 */
export function makeFinding({tool, rule, severity, subject, params = {}, evidence = [], scope = ''}) {
  return {
    id: `${tool}-${stableHash(`${scope}\n${rule}\n${subject}`)}`,
    tool,
    rule,
    severity,
    subject,
    params,
    evidence,
  };
}

export const sortFindings = (findings) =>
  [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.rule.localeCompare(b.rule));

/**
 * Whether any finding is at least as bad as `level` (high, medium, low, info),
 * for a CI run that fails; `none` never fails.
 */
export function failsAt(findings, level) {
  if (level === 'none') {
    return false;
  }
  const limit = severityRank(level);
  return findings.some((finding) => severityRank(finding.severity) <= limit);
}
