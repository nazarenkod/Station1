import {
  A11Y_CONFIG,
  A11Y_ISSUE_STATES,
  AI_CONFIG,
  BUILD_JOBS,
  DEFAULT_SETTINGS,
  GITLAB_CONFIG,
  IMPORTANT_SOURCE_ATTRIBUTES,
  IOS_SIGNING,
  JIRA_CONFIG,
  JIRA_MEMORY,
  LOG_RULES_CONFIG,
  LOGS_VIEW,
  PREFERRED_LANGUAGE,
  PREFERRED_THEME,
  PROXY_CONFIG,
  PROXY_VIEW,
  SAVED_CLIENT_FRAMEWORK,
  SAVED_SESSIONS,
  SET_SAVED_GESTURES,
} from '../setting-defs.js';

// Settings come in groups. A profile group belongs to a project and changes
// with the profile; a station group is the same for every profile. Each
// group reads its part of the settings and writes it back as a patch of
// setting keys, so the tools keep reading the keys they always did.
//
// Only what a group reads leaves the Mac: tokens and keys (*_ENCRYPTED), the
// Appium server params with the cloud keys in them, the AI consent, the
// chosen device and app, the build history and the followed pipelines are in
// no group, so they are never exported nor imported.

/** The setting keys any group touches; nothing else is ever written. */
export const GROUP_KEYS = [
  A11Y_CONFIG,
  A11Y_ISSUE_STATES,
  AI_CONFIG,
  BUILD_JOBS,
  GITLAB_CONFIG,
  IMPORTANT_SOURCE_ATTRIBUTES,
  IOS_SIGNING,
  JIRA_CONFIG,
  JIRA_MEMORY,
  LOG_RULES_CONFIG,
  LOGS_VIEW,
  PREFERRED_LANGUAGE,
  PREFERRED_THEME,
  PROXY_CONFIG,
  PROXY_VIEW,
  SAVED_CLIENT_FRAMEWORK,
  SAVED_SESSIONS,
  SET_SAVED_GESTURES,
];

// a name that looks like it holds a secret, for the groups where a person types free fields
const SECRET_NAME = /token|passw|secret|api[-_]?key|access[-_]?key|private[-_]?key|credential/i;

/** Drops every field whose name looks like a secret, at any depth. */
export function withoutSecrets(value) {
  if (Array.isArray(value)) {
    return value.map(withoutSecrets);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) => !SECRET_NAME.test(name))
      .map(([name, inner]) => [name, withoutSecrets(inner)]),
  );
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isObjectOrNull = (value) => value === null || value === undefined || isObject(value);
const isList = (value) => value === undefined || Array.isArray(value);
const isText = (value) => value === undefined || typeof value === 'string';

const omit = (value, names) =>
  Object.fromEntries(Object.entries(value ?? {}).filter(([name]) => !names.includes(name)));
const pick = (value, names) => Object.fromEntries(Object.entries(value ?? {}).filter(([name]) => names.includes(name)));

const get = (all, key) => all[key] ?? DEFAULT_SETTINGS[key];
const copy = (value) => (value === undefined ? undefined : structuredClone(value));

export const PROFILE_GROUPS = ['proxy', 'logs', 'filters', 'a11y', 'builds', 'jira'];
export const STATION_GROUPS = ['general', 'integrations', 'devices', 'inspector'];

/**
 * @type {Record<string, {
 *   scope: 'profile' | 'station',
 *   read: (all: object) => object,
 *   write: (value: object | undefined, all: object) => object,
 *   valid: (value: any) => boolean,
 * }>}
 */
export const GROUPS = {
  proxy: {
    scope: 'profile',
    // the port is the Mac's, the rules are the project's
    read: (all) => omit(get(all, PROXY_CONFIG), ['port']),
    write: (value, all) => ({
      [PROXY_CONFIG]: {
        ...DEFAULT_SETTINGS[PROXY_CONFIG],
        ...copy(value),
        port: get(all, PROXY_CONFIG).port ?? DEFAULT_SETTINGS[PROXY_CONFIG].port,
      },
    }),
    valid: (value) =>
      isObject(value) &&
      isList(value.mockRules) &&
      isObjectOrNull(value.trafficRules) &&
      (value.mockRules ?? []).every(isObject),
  },
  logs: {
    scope: 'profile',
    read: (all) => get(all, LOG_RULES_CONFIG),
    write: (value) => ({[LOG_RULES_CONFIG]: {...DEFAULT_SETTINGS[LOG_RULES_CONFIG], ...copy(value)}}),
    valid: (value) => isObject(value) && isObjectOrNull(value.overrides) && isList(value.custom),
  },
  filters: {
    scope: 'profile',
    read: (all) => ({proxy: get(all, PROXY_VIEW), logs: get(all, LOGS_VIEW)}),
    write: (value) => ({
      [PROXY_VIEW]: {...DEFAULT_SETTINGS[PROXY_VIEW], ...copy(value?.proxy)},
      [LOGS_VIEW]: {...DEFAULT_SETTINGS[LOGS_VIEW], ...copy(value?.logs)},
    }),
    valid: (value) =>
      isObject(value) &&
      isObjectOrNull(value.proxy) &&
      isObjectOrNull(value.logs) &&
      isList(value.proxy?.hiddenHosts) &&
      isList(value.proxy?.onlyHosts) &&
      isList(value.logs?.tags) &&
      isList(value.logs?.hiddenTags),
  },
  a11y: {
    scope: 'profile',
    read: (all) => ({config: get(all, A11Y_CONFIG), issues: get(all, A11Y_ISSUE_STATES)}),
    write: (value) => ({
      [A11Y_CONFIG]: copy(value?.config) ?? DEFAULT_SETTINGS[A11Y_CONFIG],
      [A11Y_ISSUE_STATES]: copy(value?.issues) ?? DEFAULT_SETTINGS[A11Y_ISSUE_STATES],
    }),
    valid: (value) => isObject(value) && isObjectOrNull(value.config) && isObjectOrNull(value.issues),
  },
  builds: {
    scope: 'profile',
    read: (all) => ({jobs: get(all, BUILD_JOBS), gitlabProject: get(all, GITLAB_CONFIG)?.project ?? ''}),
    write: (value, all) => ({
      [BUILD_JOBS]: copy(value?.jobs) ?? DEFAULT_SETTINGS[BUILD_JOBS],
      [GITLAB_CONFIG]: {...get(all, GITLAB_CONFIG), project: value?.gitlabProject ?? ''},
    }),
    valid: (value) => isObject(value) && isObjectOrNull(value.jobs) && isText(value.gitlabProject),
  },
  jira: {
    scope: 'profile',
    // the site and the account are the Mac's; the bug fields are the project's
    read: (all) => ({bug: omit(get(all, JIRA_CONFIG), ['url', 'email']), memory: get(all, JIRA_MEMORY)}),
    write: (value, all) => ({
      [JIRA_CONFIG]: {...copy(value?.bug), ...pick(get(all, JIRA_CONFIG), ['url', 'email'])},
      [JIRA_MEMORY]: copy(value?.memory) ?? DEFAULT_SETTINGS[JIRA_MEMORY],
    }),
    valid: (value) => isObject(value) && isObjectOrNull(value.bug) && isObjectOrNull(value.memory),
  },
  general: {
    scope: 'station',
    read: (all) => ({language: get(all, PREFERRED_LANGUAGE), theme: get(all, PREFERRED_THEME)}),
    write: (value) => ({
      [PREFERRED_LANGUAGE]: value?.language ?? DEFAULT_SETTINGS[PREFERRED_LANGUAGE],
      [PREFERRED_THEME]: value?.theme ?? DEFAULT_SETTINGS[PREFERRED_THEME],
    }),
    valid: (value) => isObject(value) && isText(value.language) && isText(value.theme),
  },
  integrations: {
    scope: 'station',
    read: (all) =>
      withoutSecrets({
        jira: pick(get(all, JIRA_CONFIG), ['url', 'email']),
        gitlab: pick(get(all, GITLAB_CONFIG), ['url']),
        ai: omit(get(all, AI_CONFIG), ['consent']),
      }),
    // the consent to send screens to AI is given on this Mac, never brought in
    write: (value, all) => {
      const clean = withoutSecrets(copy(value) ?? {});
      return {
        [JIRA_CONFIG]: {...get(all, JIRA_CONFIG), ...pick(clean.jira, ['url', 'email'])},
        [GITLAB_CONFIG]: {...get(all, GITLAB_CONFIG), ...pick(clean.gitlab, ['url'])},
        [AI_CONFIG]: {
          ...omit(clean.ai, ['consent']),
          consent: get(all, AI_CONFIG)?.consent ?? false,
        },
      };
    },
    valid: (value) =>
      isObject(value) && isObjectOrNull(value.jira) && isObjectOrNull(value.gitlab) && isObjectOrNull(value.ai),
  },
  devices: {
    scope: 'station',
    read: (all) => ({iosSigning: get(all, IOS_SIGNING), proxyPort: get(all, PROXY_CONFIG).port}),
    write: (value, all) => ({
      [IOS_SIGNING]: {...DEFAULT_SETTINGS[IOS_SIGNING], ...copy(value?.iosSigning)},
      [PROXY_CONFIG]: {
        ...get(all, PROXY_CONFIG),
        port: Number.isInteger(value?.proxyPort) ? value.proxyPort : DEFAULT_SETTINGS[PROXY_CONFIG].port,
      },
    }),
    valid: (value) =>
      isObject(value) &&
      isObjectOrNull(value.iosSigning) &&
      (value.proxyPort === undefined || Number.isInteger(value.proxyPort)),
  },
  inspector: {
    scope: 'station',
    // a saved session keeps its capabilities; the server it ran on, with its keys, stays here
    read: (all) =>
      withoutSecrets({
        sessions: (get(all, SAVED_SESSIONS) ?? []).map((session) => omit(session, ['server'])),
        gestures: get(all, SET_SAVED_GESTURES),
        attributes: get(all, IMPORTANT_SOURCE_ATTRIBUTES),
        framework: get(all, SAVED_CLIENT_FRAMEWORK),
      }),
    write: (value) => {
      const clean = withoutSecrets(copy(value) ?? {});
      return {
        [SAVED_SESSIONS]: (clean.sessions ?? []).map((session) => omit(session, ['server'])),
        [SET_SAVED_GESTURES]: clean.gestures ?? DEFAULT_SETTINGS[SET_SAVED_GESTURES],
        [IMPORTANT_SOURCE_ATTRIBUTES]: clean.attributes ?? DEFAULT_SETTINGS[IMPORTANT_SOURCE_ATTRIBUTES],
        [SAVED_CLIENT_FRAMEWORK]: clean.framework ?? DEFAULT_SETTINGS[SAVED_CLIENT_FRAMEWORK],
      };
    },
    valid: (value) =>
      isObject(value) &&
      isList(value.sessions) &&
      (value.sessions ?? []).every(isObject) &&
      isList(value.gestures) &&
      isList(value.attributes) &&
      isText(value.framework),
  },
};

/** The groups of one scope read from the settings, as {group: value}. */
export function readGroups(all, ids) {
  return Object.fromEntries(ids.map((id) => [id, structuredClone(GROUPS[id].read(all))]));
}

/**
 * The setting keys to write for some groups, one after another so groups
 * sharing a key (the proxy port, the Jira site) each keep their part.
 */
export function writeGroups(all, values) {
  let current = {...all};
  const patch = {};
  for (const [id, value] of Object.entries(values)) {
    const written = GROUPS[id].write(value, current);
    Object.assign(patch, written);
    current = {...current, ...written};
  }
  return patch;
}
