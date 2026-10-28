// Definitions for all the persistent settings used in the app

import {DEFAULT_MODEL} from './agent/model.js';

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
// the device and app every tool of the workstation works with, the apps used lately, and how often each device was used
export const WORKSTATION = 'WORKSTATION';
// the builds opened lately, to install them again
export const BUILDS_HISTORY = 'BUILDS_HISTORY';
// what «Start session» starts besides the session: the proxy on this Mac, the device log, the measurement
export const TEST_START = 'TEST_START';
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
// the folders of each profile's repositories on this Mac, by profile and repository; never exported
export const SOURCE_PATHS = 'SOURCE_PATHS';
// the station's agent: instructions of the station and the person, MCP servers for every profile, budgets and the credit threshold
export const AGENT_CONFIG = 'AGENT_CONFIG';
// the project's part of the agent: its instructions and MCP servers; goes with the profile
export const AGENT_PROJECT = 'AGENT_PROJECT';
// the profiles whose data the person let go to the agent, and the day the credit threshold was passed with a yes; never exported
export const AGENT_CONSENT = 'AGENT_CONSENT';
// which Kiro session holds which conversation, by profile; never exported
export const AGENT_SESSIONS = 'AGENT_SESSIONS';
// the task each profile works on now and the ones used lately; never exported
export const TASKS = 'TASKS';
// the agent's notes of this person, for every profile; never exported
export const AGENT_MEMORY = 'AGENT_MEMORY';
// the keys and files pinned at the top of the data tab, by app: [{file, key}]; goes with the profile
export const APP_DATA_PINS = 'APP_DATA_PINS';
// the project's tolerances against the reference, the runs a reference takes, the thresholds of findings; goes with the profile
export const PERF_CONFIG = 'PERF_CONFIG';

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
  [WORKSTATION]: {deviceId: null, app: null, deviceUse: {}},
  [BUILDS_HISTORY]: [],
  [TEST_START]: {proxy: true, logs: true, perf: false},
  [BUILD_JOBS]: {},
  [PIPELINE_WATCHES]: [],
  [LOG_RULES_CONFIG]: {overrides: {}, custom: []},
  [IOS_SIGNING]: {teamId: null, bundleId: ''},
  [PROXY_CONFIG]: {port: 8890, mockRules: [], trafficRules: {}, mocksEnabled: true, breakpointsEnabled: true},
  [PROXY_VIEW]: {view: 'list', hiddenHosts: [], onlyHosts: [], expanded: []},
  [LOGS_VIEW]: {scope: 'app', minLevel: 'V', query: '', tags: [], hiddenTags: []},
  [PROFILES]: null,
  [SOURCE_PATHS]: {},
  [AGENT_CONFIG]: {
    stationInstructions: null,
    personalInstructions: '',
    mcpServers: [],
    readBudget: 40000,
    deepBudget: 200000,
    dailyCreditLimit: 0,
    // the model every conversation is pinned to; the newest of its family when the account lacks it
    model: DEFAULT_MODEL,
  },
  [AGENT_PROJECT]: {instructions: '', mcpServers: [], notes: []},
  [AGENT_CONSENT]: {profiles: {}, confirmedDay: null},
  [AGENT_SESSIONS]: {},
  [TASKS]: {},
  [AGENT_MEMORY]: {notes: []},
  [APP_DATA_PINS]: {},
  // the values in place are in shared/perf/baseline.js (PERF_DEFAULTS); an empty object takes them all
  [PERF_CONFIG]: {},
};
