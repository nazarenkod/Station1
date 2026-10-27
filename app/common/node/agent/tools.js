import {z} from 'zod';

import {compileMasks, maskText} from '../../shared/agent/privacy.js';
import {
  changeLogRules,
  changeMock,
  changeTrafficRules,
  changeView,
  findingsList,
  logsSearch,
  logsStats,
  trafficGet,
  trafficSearch,
  trafficStats,
} from '../../shared/agent/station-tools.js';
import {DEFAULT_SETTINGS, LOG_RULES_CONFIG, LOGS_VIEW, PROXY_CONFIG, PROXY_VIEW} from '../../shared/setting-defs.js';
import {withoutSecrets} from '../../shared/settings/groups.js';
import {changesToDiscard, fetchRepo, pullRepo, repoRoot, switchBranch} from '../source/repo.js';

// The tools of the station for the agent. Read tools give data and the
// budget decides how much of it goes back; change tools go through the
// journal, so each change can be rolled back, and the person approves each
// call in the chat before it runs.

const since = z.number().int().positive().optional().describe('Only the last N minutes');
const limit = z.number().int().positive().max(100).optional().describe('Rows to return (default 20, logs 50)');
const offset = z.number().int().nonnegative().optional().describe('Rows to skip, for the next page');

const SETTING_GROUPS = {
  proxy: PROXY_CONFIG,
  logs: LOG_RULES_CONFIG,
  proxyView: PROXY_VIEW,
  logsView: LOGS_VIEW,
};

/**
 * @param {object} deps
 * @param {() => object} deps.proxy the proxy's snapshot: exchanges, findings, status
 * @param {() => object | null} deps.logs the log's snapshot: entries, findings, status
 * @param {(kind: string, args?: object) => Promise<any>} deps.ask asks the window: state, screen, flow, a11y findings
 * @param {(key: string) => Promise<any>} deps.get reads a setting
 * @param {ReturnType<import('./changes.js').createChangeJournal>} deps.journal
 * @param {(conversation: string) => number} deps.turnOf the turn a conversation is in
 * @param {() => Promise<{profileId: string, source: object, paths: object}>} deps.project the profile that is on and its code
 * @param {(profileId: string, repoId: string, value: object) => Promise<void>} deps.rememberBranch
 * @param {() => Promise<string[]>} deps.maskPatterns
 */
export function stationTools(deps) {
  const masks = async () => compileMasks(await deps.maskPatterns());
  const setting = async (key) => (await deps.get(key)) ?? DEFAULT_SETTINGS[key];

  const change =
    (tool, key, compute) =>
    async (args, {conversation}) => {
      const entry = await deps.journal.apply({
        conversation,
        turn: deps.turnOf(conversation),
        tool,
        key,
        fallback: DEFAULT_SETTINGS[key],
        compute: (value) => compute(value, args),
      });
      if (entry.error) {
        return `Not changed: ${entry.error}`;
      }
      return `Done: ${entry.summary}${entry.extra?.id ? ` (id ${entry.extra.id})` : ''}. The user can roll it back from the chat.`;
    };

  // a repository of the profile that is on, by name or id; the main one when none is given
  const repoOf = async (wanted) => {
    const {profileId, source, paths} = await deps.project();
    const repo = wanted
      ? source.repos.find((one) => one.id === wanted || one.name === wanted)
      : source.repos.find((one) => paths[one.id]?.path);
    if (!repo || !paths[repo.id]?.path) {
      throw new Error('No repository of the project on this Mac; the user adds one in the profile settings.');
    }
    const root = await repoRoot(paths[repo.id].path);
    if (!root) {
      throw new Error(`${repo.name} is not a git repository any more.`);
    }
    return {profileId, repo, root};
  };

  return [
    {
      name: 'station_state',
      readOnly: true,
      description:
        'What the station is doing now: profile, device, app, the open tab, Appium session, proxy and log status, the screen on the device. Short; call it first.',
      input: {},
      run: async () => {
        const proxy = deps.proxy();
        const logs = deps.logs();
        const view = await deps.ask('state').catch(() => null);
        return {
          ...view,
          proxy: {running: !!proxy?.status?.running, requests: proxy?.exchanges?.length ?? 0},
          log: {state: logs?.status?.state ?? 'off', lines: logs?.entries?.length ?? 0},
        };
      },
    },
    {
      name: 'traffic_stats',
      readOnly: true,
      description: 'Proxy traffic without rows: endpoints by count with statuses, average and max time, flags.',
      input: {since_minutes: since, host: z.string().optional().describe('Only hosts containing this')},
      run: async ({since_minutes: sinceMinutes, host}) =>
        trafficStats(deps.proxy()?.exchanges ?? [], {sinceMinutes, host}),
    },
    {
      name: 'traffic_search',
      readOnly: true,
      description:
        'Requests that match, newest first, one line each with their id. Filter as much as you can; get one request whole with traffic_get.',
      input: {
        host: z.string().optional(),
        path: z.string().optional().describe('A part of the URL'),
        method: z.string().optional(),
        status: z.string().optional().describe('"422", "4xx", "5xx" or "error" (no answer)'),
        flag: z.string().optional().describe('slow, dupe, mock, error, contract…'),
        since_minutes: since,
        limit,
        offset,
      },
      run: async ({since_minutes: sinceMinutes, ...filters}) =>
        trafficSearch(deps.proxy()?.exchanges ?? [], {...filters, sinceMinutes}, {masks: await masks()}),
    },
    {
      name: 'traffic_get',
      readOnly: true,
      description:
        'One request by id: headers (secrets masked) and the start of each body. Prefer fields: JSON paths like "request.body.purpose", "response.body.items[0].id", "request.query.page".',
      input: {
        id: z.string(),
        fields: z.array(z.string()).optional(),
        body_limit: z
          .number()
          .int()
          .positive()
          .max(20000)
          .optional()
          .describe('Characters of each body (default 4000)'),
      },
      run: async ({id, fields, body_limit: bodyLimit}) => {
        const exchange = (deps.proxy()?.exchanges ?? []).find((one) => one.id === id);
        return trafficGet(exchange, {fields, bodyLimit, masks: await masks()});
      },
    },
    {
      name: 'logs_stats',
      readOnly: true,
      description: 'The device log without lines: counts by level, the tags with most errors.',
      input: {since_minutes: since},
      run: async ({since_minutes: sinceMinutes}) => logsStats(deps.logs()?.entries ?? [], {sinceMinutes}),
    },
    {
      name: 'logs_search',
      readOnly: true,
      description:
        'Log lines that match, newest first. Narrow by level (V D I W E F, from this level up), tag, text or regex; context gives lines around each hit (up to 5).',
      input: {
        level: z.enum(['V', 'D', 'I', 'W', 'E', 'F']).optional(),
        tag: z.string().optional(),
        text: z.string().optional(),
        regex: z.string().optional(),
        since_minutes: since,
        context: z.number().int().min(0).max(5).optional(),
        limit,
        offset,
      },
      run: async ({since_minutes: sinceMinutes, ...filters}) =>
        logsSearch(deps.logs()?.entries ?? [], {...filters, sinceMinutes}, {masks: await masks()}),
    },
    {
      name: 'findings_list',
      readOnly: true,
      description:
        'What the station flagged: proxy (errors, slow, duplicates, contract), logs (crashes, ANR), accessibility.',
      input: {
        source: z.enum(['proxy', 'logs', 'a11y', 'builds']).optional(),
        severity: z.enum(['high', 'medium', 'low', 'info']).optional(),
        limit,
      },
      run: async (args) => {
        const a11y = await deps.ask('a11yFindings').catch(() => []);
        const all = [...(deps.proxy()?.findings ?? []), ...(deps.logs()?.findings ?? []), ...(a11y ?? [])];
        return findingsList(all, args, {masks: await masks()});
      },
    },
    {
      name: 'screen_current',
      readOnly: true,
      limit: 6000,
      description:
        'The screen on the device: its name, state and a compact UI tree (meaningful elements only). A screenshot only with screenshot: true, when the tree cannot answer.',
      input: {screenshot: z.boolean().optional()},
      run: async ({screenshot}) => await deps.ask('screen', {screenshot: !!screenshot}),
    },
    {
      name: 'screen_flow',
      readOnly: true,
      description: 'The screens of this session with their states, and the path between them.',
      input: {},
      run: async () => await deps.ask('flow'),
    },
    {
      name: 'settings_get',
      readOnly: true,
      description:
        'Settings of the project: proxy (mock rules, traffic rules, modes), logs (log rules), proxyView and logsView (filters).',
      input: {group: z.enum(Object.keys(SETTING_GROUPS))},
      run: async ({group}) => {
        const value = withoutSecrets(await setting(SETTING_GROUPS[group]));
        return JSON.parse(maskText(JSON.stringify(value), await masks()));
      },
    },
    {
      name: 'proxy_mock_set',
      readOnly: false,
      description:
        'Adds, changes, removes, enables or disables a proxy mock rule. rule: {url (pattern, * = anything), method, action (respond|redirect|delay|fail|breakpoint), status, headers ("name: value" lines), body, target, delayMs, stage, name}.',
      input: {
        op: z.enum(['add', 'update', 'remove', 'enable', 'disable']),
        id: z.string().optional(),
        rule: z.record(z.string(), z.any()).optional(),
      },
      run: change('proxy_mock_set', PROXY_CONFIG, (config, args) => changeMock(config, args)),
    },
    {
      name: 'proxy_rule_set',
      readOnly: false,
      description:
        'Changes the traffic rules by parts: {duplicates|slow|errors|contract|ignore: {field: value}}, e.g. {"slow": {"defaultMs": 2000}}.',
      input: {rules: z.record(z.string(), z.record(z.string(), z.any()))},
      run: change('proxy_rule_set', PROXY_CONFIG, (config, {rules}) => changeTrafficRules(config, rules)),
    },
    {
      name: 'log_rule_set',
      readOnly: false,
      description:
        'A custom log rule: add {name, pattern (regex), tag, minLevel, severity, scope app|device}, update or remove by id; or override a built-in one by id ({enabled, severity}).',
      input: {
        op: z.enum(['add', 'update', 'remove', 'override']),
        id: z.string().optional(),
        rule: z.record(z.string(), z.any()).optional(),
      },
      run: change('log_rule_set', LOG_RULES_CONFIG, (config, args) => changeLogRules(config, args)),
    },
    {
      name: 'view_set',
      readOnly: false,
      description:
        'Changes what the proxy or the log shows. proxy: {view list|domains, hiddenHosts[], onlyHosts[]}; logs: {scope app|device, minLevel, query, tags[], hiddenTags[]}.',
      input: {which: z.enum(['proxy', 'logs']), patch: z.record(z.string(), z.any())},
      run: async (args, context) =>
        await change('view_set', args.which === 'proxy' ? PROXY_VIEW : LOGS_VIEW, (view, {which, patch}) =>
          changeView(view, which, patch),
        )(args, context),
    },
    {
      name: 'repo_fetch',
      readOnly: false,
      description: 'git fetch of a repository of the project (the main one when repo is not given).',
      input: {repo: z.string().optional().describe('Name or id of the repository')},
      run: async ({repo}) => {
        const {root, repo: one} = await repoOf(repo);
        const result = await fetchRepo(root);
        return result.ok ? `Fetched ${one.name} from origin.` : `Not fetched: ${result.error}. ${result.detail ?? ''}`;
      },
    },
    {
      name: 'repo_checkout',
      readOnly: false,
      description:
        "Switches a repository of the project to a branch. Local changes in the station's copy are discarded first. The user can switch back.",
      input: {branch: z.string(), repo: z.string().optional()},
      run: async ({branch, repo}, {conversation}) => {
        const {profileId, root, repo: one} = await repoOf(repo);
        const result = await switchBranch(root, branch);
        if (!result.ok) {
          return `Not switched: ${result.error}. ${result.detail ?? ''}`;
        }
        if (result.previous && result.previous !== branch) {
          await deps.rememberBranch(profileId, one.id, result.previous);
          deps.journal.note({
            conversation,
            turn: deps.turnOf(conversation),
            tool: 'repo_checkout',
            summary: `${one.name}: ${result.previous} → ${branch}`,
            revert: async () => {
              await switchBranch(root, result.previous);
            },
          });
        }
        return `Switched ${one.name} to ${branch}${result.discarded.length ? `, ${result.discarded.length} local changes discarded` : ''}.`;
      },
      // what the person sees before saying yes
      preview: async ({branch, repo}) => {
        const {repo: one, root} = await repoOf(repo);
        const discarded = await changesToDiscard(root);
        return {
          repo: one.name,
          branch,
          discard: discarded.slice(0, 20).map((c) => `${c.repo === '.' ? '' : `${c.repo}/`}${c.path}`),
          more: Math.max(0, discarded.length - 20),
        };
      },
    },
    {
      name: 'repo_pull',
      readOnly: false,
      description: 'git pull --ff-only of a repository of the project, then its submodules.',
      input: {repo: z.string().optional()},
      run: async ({repo}) => {
        const {root, repo: one} = await repoOf(repo);
        const result = await pullRepo(root);
        return result.ok ? `Pulled ${one.name}.` : `Not pulled: ${result.error}. ${result.detail ?? ''}`;
      },
    },
  ];
}
