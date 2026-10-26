import {makeFinding, sortFindings} from './findings.js';

// Android 12 (API 31) made components with intent filters say whether they are exported
const IMPLICIT_EXPORT_UNTIL_SDK = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

export const DANGEROUS_PERMISSIONS = [
  'android.permission.READ_SMS',
  'android.permission.RECEIVE_SMS',
  'android.permission.SEND_SMS',
  'android.permission.READ_CALL_LOG',
  'android.permission.READ_CONTACTS',
  'android.permission.READ_PHONE_STATE',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.RECORD_AUDIO',
  'android.permission.CAMERA',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.MANAGE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.REQUEST_INSTALL_PACKAGES',
  'android.permission.QUERY_ALL_PACKAGES',
];

/**
 * The manifest rules with their defaults. A project's rules file can turn
 * each off, change its severity or its numbers.
 */
export const MANIFEST_RULES = {
  'android-allow-backup': {platform: 'android', severity: 'high'},
  'android-debuggable': {platform: 'android', severity: 'medium'},
  'android-cleartext': {platform: 'android', severity: 'high'},
  'android-exported': {platform: 'android', severity: 'medium'},
  'android-dangerous-permissions': {platform: 'android', severity: 'low', permissions: DANGEROUS_PERMISSIONS},
  'android-target-sdk': {platform: 'android', severity: 'medium', minTargetSdk: 35},
  'android-test-only': {platform: 'android', severity: 'low'},
  'ios-ats-arbitrary-loads': {platform: 'ios', severity: 'high'},
  'ios-ats-insecure-domain': {platform: 'ios', severity: 'medium'},
  'ios-get-task-allow': {platform: 'ios', severity: 'medium'},
  'ios-file-sharing': {platform: 'ios', severity: 'medium'},
  'ios-url-schemes': {platform: 'ios', severity: 'info'},
  'ios-profile-expiring': {platform: 'ios', severity: 'medium', days: 14},
};

const shortName = (name) => name.replace(/^android\.permission\./, '');

const ANDROID_CHECKS = {
  'android-allow-backup': (m) =>
    m.application.allowBackup ? [{subject: 'application', evidence: ['android:allowBackup="true"']}] : [],
  'android-debuggable': (m) =>
    m.application.debuggable ? [{subject: 'application', evidence: ['android:debuggable="true"']}] : [],
  'android-cleartext': (m) =>
    m.application.usesCleartextTraffic
      ? [{subject: 'application', evidence: ['android:usesCleartextTraffic="true"']}]
      : [],
  'android-exported': (m) =>
    m.components
      .filter((c) => !c.launcher && !c.permission)
      .filter(
        (c) =>
          c.exported === true ||
          (c.exported === null && c.hasIntentFilter && (m.targetSdk ?? 0) < IMPLICIT_EXPORT_UNTIL_SDK),
      )
      .map((c) => ({
        subject: c.name,
        params: {component: c.name.split('.').pop(), type: c.type},
        evidence: [
          `<${c.type} android:name="${c.name}" android:exported="${c.exported ?? 'implicit'}">`,
          ...c.actions.map((a) => `action ${a}`),
        ],
      })),
  'android-dangerous-permissions': (m, rule) => {
    const found = m.permissions.filter((p) => rule.permissions.includes(p));
    return found.length
      ? [
          {
            subject: 'permissions',
            params: {count: found.length, list: found.map(shortName).join(', ')},
            evidence: found,
          },
        ]
      : [];
  },
  'android-target-sdk': (m, rule) =>
    m.targetSdk !== null && m.targetSdk < rule.minTargetSdk
      ? [
          {
            subject: 'targetSdk',
            params: {target: m.targetSdk, min: rule.minTargetSdk},
            evidence: [`targetSdkVersion=${m.targetSdk}`],
          },
        ]
      : [],
  'android-test-only': (m) =>
    m.application.testOnly ? [{subject: 'application', evidence: ['android:testOnly="true"']}] : [],
};

const IOS_CHECKS = {
  'ios-ats-arbitrary-loads': (m) =>
    m.ats.arbitraryLoads
      ? [{subject: 'ats', evidence: ['NSAppTransportSecurity › NSAllowsArbitraryLoads = true']}]
      : [],
  'ios-ats-insecure-domain': (m) =>
    m.ats.exceptionDomains
      .filter((d) => d.insecureHttp)
      .map((d) => ({
        subject: d.domain,
        params: {domain: d.domain},
        evidence: [`NSExceptionDomains › ${d.domain} › NSExceptionAllowsInsecureHTTPLoads = true`],
      })),
  'ios-get-task-allow': (m) =>
    m.entitlements['get-task-allow'] ? [{subject: 'entitlements', evidence: ['get-task-allow = true']}] : [],
  'ios-file-sharing': (m) =>
    m.fileSharing
      ? [
          {
            subject: 'fileSharing',
            evidence: [
              `UIFileSharingEnabled = true${m.openInPlace ? ', LSSupportsOpeningDocumentsInPlace = true' : ''}`,
            ],
          },
        ]
      : [],
  'ios-url-schemes': (m) =>
    m.urlSchemes.length
      ? [{subject: 'urlSchemes', params: {list: m.urlSchemes.join(', ')}, evidence: m.urlSchemes.map((s) => `${s}://`)}]
      : [],
  'ios-profile-expiring': (m, rule, now) => {
    const expires = m.profile?.expires ? Date.parse(m.profile.expires) : NaN;
    if (Number.isNaN(expires)) {
      return [];
    }
    const days = Math.floor((expires - now) / DAY_MS);
    return days <= rule.days
      ? [
          {
            subject: 'profile',
            params: {days: Math.max(days, 0), expired: days < 0},
            evidence: [`ExpirationDate = ${m.profile.expires}`],
          },
        ]
      : [];
  },
};

/**
 * The project's settings over the defaults: {rule: {enabled, severity, ...}}.
 */
export function mergeManifestRules(overrides = {}) {
  return Object.fromEntries(
    Object.entries(MANIFEST_RULES).map(([id, rule]) => [id, {enabled: true, ...rule, ...(overrides[id] ?? {})}]),
  );
}

/**
 * Checks a build (as inspectBuild reads it) against the manifest rules.
 */
export function checkManifest(build, overrides = {}, now = Date.now()) {
  const rules = mergeManifestRules(overrides);
  const checks = build.platform === 'android' ? ANDROID_CHECKS : IOS_CHECKS;
  const findings = Object.entries(checks).flatMap(([id, check]) => {
    const rule = rules[id];
    if (!rule?.enabled) {
      return [];
    }
    return check(build.manifest, rule, now).map((hit) =>
      makeFinding({tool: 'builds', rule: id, severity: rule.severity, scope: build.appId, ...hit}),
    );
  });
  return sortFindings(findings);
}
