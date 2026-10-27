// Definitions for all the persistent settings used in the app

// the workstation speaks Ukrainian until the user picks another language
export const DEFAULT_LANGUAGE = 'uk';

export const PREFERRED_LANGUAGE = 'PREFERRED_LANGUAGE';
export const PREFERRED_THEME = 'PREFERRED_THEME';
export const SAVED_SESSIONS = 'SAVED_SESSIONS';
export const SET_SAVED_GESTURES = 'SET_SAVED_GESTURES';
export const SERVER_ARGS = 'SERVER_ARGS';
export const SESSION_SERVER_PARAMS = 'SESSION_SERVER_PARAMS';
export const SESSION_SERVER_TYPE = 'SESSION_SERVER_TYPE';
export const SAVED_CLIENT_FRAMEWORK = 'SAVED_FRAMEWORK';
export const VISIBLE_PROVIDERS = 'VISIBLE_PROVIDERS';
export const IMPORTANT_SOURCE_ATTRIBUTES = 'IMPORTANT_SOURCE_ATTRIBUTES';
// accessibility rules, thresholds and patterns (see lib/a11y/config)
export const A11Y_CONFIG = 'A11Y_CONFIG';
// decisions about accessibility issues: filed bugs and ignored ones, per app and screen
export const A11Y_ISSUE_STATES = 'A11Y_ISSUE_STATES';
// Jira Cloud site, account and bug defaults; the API token is kept apart, encrypted
export const JIRA_CONFIG = 'JIRA_CONFIG';
// AI provider, model and what may be sent; the API key is kept apart, encrypted
export const AI_CONFIG = 'AI_CONFIG';
// what the Jira dialog remembers: the task per screen, the block, the most used types and field values
export const JIRA_MEMORY = 'JIRA_MEMORY';
// GitLab site and the project builds come from; the access token is kept apart, encrypted
export const GITLAB_CONFIG = 'GITLAB_CONFIG';
// the device and app every tool of the workstation works with, and the apps used lately
export const WORKSTATION = 'WORKSTATION';
// the builds opened lately, to install them again
export const BUILDS_HISTORY = 'BUILDS_HISTORY';
// the jobs each GitLab project leaves its builds in, by project path, and the build picked in their archive
export const BUILD_JOBS = 'BUILD_JOBS';
// the pipelines the Builds tool follows, with the devices their build goes to
export const PIPELINE_WATCHES = 'PIPELINE_WATCHES';
// log rules: built-in ones turned off or changed, and the project's own patterns
export const LOG_RULES_CONFIG = 'LOG_RULES_CONFIG';
// the proxy: its port, rewrite rules, traffic rules and modes
export const PROXY_CONFIG = 'PROXY_CONFIG';
// how WebDriverAgent is signed for a real iPhone: the development team and its bundle id
export const IOS_SIGNING = 'IOS_SIGNING';
// what the proxy shows: list or domains, the hidden domains, the only ones, the open ones
export const PROXY_VIEW = 'PROXY_VIEW';
// what the log shows: the app or the whole device, the lowest level, the search, the tags
export const LOGS_VIEW = 'LOGS_VIEW';
// the project profiles: their names, apps and settings, and which one is on
export const PROFILES = 'PROFILES';

// Attributes which are listed in the source by default
export const IMPORTANT_SOURCE_ATTRS = [
  'AXDescription',
  'AXIdentifier',
  'content-desc',
  'id',
  'label',
  'name',
  'resource-id',
  'text',
  'value',
];

export const DEFAULT_SETTINGS = {
  [PREFERRED_LANGUAGE]: DEFAULT_LANGUAGE,
  [PREFERRED_THEME]: 'system',
  [SAVED_SESSIONS]: [],
  [SET_SAVED_GESTURES]: [],
  [SERVER_ARGS]: null,
  [SESSION_SERVER_PARAMS]: null,
  [SESSION_SERVER_TYPE]: null,
  [SAVED_CLIENT_FRAMEWORK]: 'java',
  [VISIBLE_PROVIDERS]: null,
  [IMPORTANT_SOURCE_ATTRIBUTES]: IMPORTANT_SOURCE_ATTRS,
  [A11Y_CONFIG]: null,
  [A11Y_ISSUE_STATES]: {},
  [JIRA_CONFIG]: null,
  [AI_CONFIG]: null,
  [JIRA_MEMORY]: {},
  [GITLAB_CONFIG]: null,
  [WORKSTATION]: {deviceId: null, app: null},
  [BUILDS_HISTORY]: [],
  [BUILD_JOBS]: {},
  [PIPELINE_WATCHES]: [],
  [LOG_RULES_CONFIG]: {overrides: {}, custom: []},
  [IOS_SIGNING]: {teamId: null, bundleId: ''},
  [PROXY_CONFIG]: {port: 8890, mockRules: [], trafficRules: {}, mocksEnabled: true, breakpointsEnabled: true},
  [PROXY_VIEW]: {view: 'list', hiddenHosts: [], onlyHosts: [], expanded: []},
  [LOGS_VIEW]: {scope: 'app', minLevel: 'V', query: '', tags: [], hiddenTags: []},
  [PROFILES]: null,
};
