import {randomUUID} from 'node:crypto';
import {access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {app, BrowserWindow, ipcMain, shell} from 'electron';
import settings from 'electron-settings';

import {appDataTools} from '../../../common/node/agent/app-data-tools.js';
import {createChangeJournal} from '../../../common/node/agent/changes.js';
import {createCreditsStore} from '../../../common/node/agent/credits-store.js';
import {envTools} from '../../../common/node/agent/env-tools.js';
import {KiroAgent} from '../../../common/node/agent/kiro.js';
import {testMcpServer} from '../../../common/node/agent/mcp-test.js';
import {createMemoryStore} from '../../../common/node/agent/memory-store.js';
import {memoryTools} from '../../../common/node/agent/memory-tools.js';
import {createAgentService} from '../../../common/node/agent/service.js';
import {createStationMcp} from '../../../common/node/agent/station-mcp.js';
import {taskTools} from '../../../common/node/agent/task-tools.js';
import {stationTools} from '../../../common/node/agent/tools.js';
import {run, shellEnv} from '../../../common/node/doctor/exec.js';
import {inspectRepo} from '../../../common/node/source/repo.js';
import {DEFAULT_STATION_INSTRUCTIONS} from '../../../common/shared/agent/instructions.js';
import {cleanServer, secretNames, toAcpServers} from '../../../common/shared/agent/mcp-servers.js';
import {compileMasks, DEFAULT_MASK_PATTERNS} from '../../../common/shared/agent/privacy.js';
import {AGENT_CONFIG, AI_CONFIG, DEFAULT_SETTINGS, SOURCE_PATHS} from '../../../common/shared/setting-defs.js';
import {platformKey} from '../../../common/shared/settings/platforms.js';
import {agentWorkspace, branchToRemember, sourceFor} from '../../../common/shared/settings/source.js';
import {encryptedSecret} from '../secrets.js';

const BRIDGE_TIMEOUT_MS = 8000;

const broadcast = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
};

// the hidden fields of an MCP server (tokens, keys), together, in the keychain
const serverSecret = (serverId) => encryptedSecret(`AGENT_MCP_${serverId.replace(/[^\w-]/g, '')}_ENCRYPTED`, 'key');

const readSecrets = async (serverId) => {
  try {
    return JSON.parse((await serverSecret(serverId).read()) ?? '{}');
  } catch {
    return {};
  }
};

// kiro-cli from the PATH of the login shell, or where its installer puts it
async function kiroBinary() {
  const local = path.join(os.homedir(), '.local', 'bin', 'kiro-cli');
  const env = await shellEnv();
  for (const dir of String(env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(dir, 'kiro-cli');
    try {
      await access(candidate);
      return candidate;
    } catch {
      // the next one
    }
  }
  return local;
}

/**
 * The station's agent: Kiro over ACP, the station's MCP server with its
 * tools, the journal of the agent's changes and the credits ledger.
 */
export function setupAgentIPC({station, proxy, logs, tasks, doctor, appData}) {
  const home = path.join(app.getPath('userData'), 'agent', 'workspace');
  const get = (key) => settings.get(key);
  const set = (key, value) => settings.set(key, value);

  // the window answers what only it knows: the open tab, the screen, the flow
  const waiting = new Map();
  const askWindow = (kind, args = {}) =>
    new Promise((resolve, reject) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) {
        reject(new Error('The station window is closed'));
        return;
      }
      const id = randomUUID();
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error('The station window did not answer'));
      }, BRIDGE_TIMEOUT_MS);
      waiting.set(id, {resolve, timer});
      window.webContents.send('agent:ask', {id, kind, args});
    });
  ipcMain.handle('agent:answer', (_evt, id, result) => {
    const one = waiting.get(id);
    if (one) {
      clearTimeout(one.timer);
      waiting.delete(id);
      one.resolve(result);
    }
  });

  const journal = createChangeJournal({
    get,
    set,
    onChanged: async (keys) => broadcast('settings:changed', {profiles: await station.profiles(), keys}),
  });

  const project = async () => {
    const profiles = await station.profiles();
    const profile = profiles.list.find((one) => one.id === profiles.activeId);
    return {profileId: profile.id, source: profile.source, paths: await station.sourcePaths(profile.id)};
  };

  const maskPatterns = async () => (await get(AI_CONFIG))?.maskPatterns ?? DEFAULT_MASK_PATTERNS;
  const memory = createMemoryStore({
    get,
    set,
    tasks: tasks.store,
    current: tasks.current,
    masks: async () => compileMasks(await maskPatterns()),
  });

  let service = null;
  const tools = [
    ...stationTools({
      proxy: () => proxy.snapshot(),
      logs: () => logs.snapshot(),
      ask: askWindow,
      get,
      journal,
      turnOf: (conversation) => service?.turnOf(conversation) ?? 0,
      project,
      rememberBranch: async (profileId, repoId, previous) => {
        const known = (await station.sourcePaths(profileId))[repoId] ?? {};
        await station.setSourcePath(profileId, repoId, {
          previousBranch: branchToRemember(known.previousBranch, previous, null),
        });
      },
      maskPatterns,
    }),
    ...memoryTools({
      store: memory,
      masks: async () => compileMasks(await maskPatterns()),
      onUsed: async (conversation, notes) => {
        await memory.markUsed(notes.map((note) => note.id));
        broadcast('agent:memoryUsed', {
          sessionId: service?.sessionOf(conversation),
          notes: notes.map(({id, text, kind, scope}) => ({id, text, kind, scope})),
        });
      },
      propose: ({conversation, ...proposal}) =>
        broadcast('agent:memoryProposal', {sessionId: service?.sessionOf(conversation), ...proposal}),
    }),
    ...envTools({
      check: doctor.check,
      installDriver: doctor.installDriver,
      installAppium: doctor.installAppium,
      runShell: async (command, options) =>
        // interactive, as a terminal: nvm and the PATH of ~/.zshrc are there
        await run(process.env.SHELL || '/bin/zsh', ['-ilc', command], {...options, env: await shellEnv()}),
      onFixed: doctor.changed,
    }),
    ...appDataTools({service: appData, masks: async () => compileMasks(await maskPatterns())}),
    ...taskTools({
      current: tasks.current,
      store: tasks.store,
      turnOf: (conversation) => service?.turnOf(conversation) ?? 0,
      onChanged: tasks.changed,
      proposeGoal: ({conversation, ...proposal}) =>
        broadcast('agent:goalProposal', {sessionId: service?.sessionOf(conversation), ...proposal}),
    }),
  ];

  const mcp = createStationMcp({
    tools,
    onEvent: (conversation, event) =>
      broadcast('agent:budget', {sessionId: service?.sessionOf(conversation), conversation, ...event}),
  });

  // the person's answer to a permission card
  const permissions = new Map();
  const askPerson = async (request) => {
    const id = randomUUID();
    const name = request._meta?.kiro?.mcpTool?.identity;
    const tool = name?.serverName === 'station' ? tools.find((one) => one.name === name.toolName) : null;
    const preview = tool?.preview ? await tool.preview(request.input ?? {}).catch(() => null) : null;
    broadcast('agent:permission', {
      id,
      sessionId: request.sessionId,
      title: request.toolCall?.title ?? '',
      server: name?.serverName ?? null,
      tool: name?.toolName ?? null,
      input: request.input,
      preview,
      options: request.options ?? [],
    });
    return await new Promise((resolve) => permissions.set(id, resolve));
  };
  ipcMain.handle('agent:permissionAnswer', (_evt, id, optionId) => {
    const resolve = permissions.get(id);
    permissions.delete(id);
    resolve?.(optionId ? {optionId} : null);
  });

  const kiro = new KiroAgent({
    binary: kiroBinary,
    env: shellEnv,
    onPermission: (request) => service.permission(request),
    onOpenUrl: async (url) => {
      if (/^https:\/\//i.test(url)) {
        await shell.openExternal(url);
      }
    },
  });
  kiro.on('exit', () => broadcast('agent:exit', {}));

  const credits = createCreditsStore(path.join(app.getPath('userData'), 'agent', 'credits.json'));

  service = createAgentService({
    kiro,
    mcp,
    credits,
    get,
    set,
    home,
    send: broadcast,
    ask: askPerson,
    secrets: readSecrets,
    pinnedNotes: async () => (await memory.pinned()).notes.map((note) => note.text),
    notesFor: async (chips) => {
      const tags = {
        screen: chips.find((one) => one.kind === 'screen')?.label,
        endpoint: chips.find((one) => one.kind === 'request')?.label,
      };
      return tags.screen || tags.endpoint ? await memory.search('', tags) : [];
    },
    // the analysis of a task learns what it cost when its turn is metered
    onTurn: async ({profileId, taskKey, conversation, turn, credits}) => {
      if (taskKey && (await tasks.store.creditImpact(profileId, taskKey, {conversation, turn}, credits))) {
        tasks.changed({profileId, key: taskKey});
      }
    },
    workspace: async (profileId) => {
      const profile = (await station.profiles()).list.find((one) => one.id === profileId);
      const paths = ((await get(SOURCE_PATHS)) ?? {})[profileId] ?? {};
      const states = {};
      for (const repo of profile?.source.repos ?? []) {
        if (paths[repo.id]?.path) {
          states[repo.id] = await inspectRepo(paths[repo.id].path);
        }
      }
      // the device in the title bar says which platform's code the operator reads
      const state = await askWindow('state').catch(() => null);
      const platform = /ios/i.test(state?.device?.platform ?? '')
        ? 'ios'
        : /android/i.test(state?.device?.platform ?? '')
          ? 'android'
          : null;
      // the code of the device's platform; with no device, or one the project is not for, all of it
      const key = profile && platform ? platformKey(profile, platform) : null;
      return agentWorkspace(sourceFor(profile?.source ?? {repos: []}, key), paths, states);
    },
  });

  ipcMain.handle('agent:open', (_evt, request) => service.open(request));
  ipcMain.handle('agent:new', (_evt, request) => service.newConversation(request));
  ipcMain.handle('agent:resume', (_evt, request) => service.resume(request));
  ipcMain.handle('agent:past', (_evt, profileId) => service.past(profileId));
  ipcMain.handle('agent:prompt', (_evt, request) => service.prompt(request));
  ipcMain.handle('agent:cancel', (_evt, sessionId) => service.cancel(sessionId));
  ipcMain.handle('agent:consent', (_evt, profileId, given) => service.consent(profileId, given));
  ipcMain.handle('agent:consented', (_evt, profileId) => service.consented(profileId));
  ipcMain.handle('agent:turn', (_evt, sessionId) => service.turnOf(service.conversationOf(sessionId)));
  ipcMain.handle('agent:extend', (_evt, sessionId) => {
    const conversation = service.conversationOf(sessionId);
    if (conversation) {
      mcp.extend(conversation);
    }
  });
  ipcMain.handle('agent:changes', (_evt, sessionId) => journal.list(service.conversationOf(sessionId)));
  ipcMain.handle('agent:undo', (_evt, id, force) => journal.undo(id, {force}));
  ipcMain.handle('agent:undoTurn', (_evt, sessionId, turn, force) =>
    journal.undoTurn(service.conversationOf(sessionId), turn, {force}),
  );
  ipcMain.handle('agent:credits', async () => ({summary: await credits.summary(), usage: await kiro.usage()}));
  ipcMain.handle('agent:defaults', () => ({stationInstructions: DEFAULT_STATION_INSTRUCTIONS}));

  ipcMain.handle('agent:mcpSecretNames', async (_evt, serverId) => Object.keys(await readSecrets(serverId)));
  ipcMain.handle('agent:setMcpSecrets', async (_evt, serverId, values) => {
    const kept = {...(await readSecrets(serverId)), ...values};
    const clean = Object.fromEntries(Object.entries(kept).filter(([, value]) => value));
    await serverSecret(serverId).write(Object.keys(clean).length ? JSON.stringify(clean) : null);
    return Object.keys(clean);
  });
  ipcMain.handle('agent:testMcp', async (_evt, definition) => {
    const server = cleanServer(definition);
    const secrets = secretNames(server).length ? {[server.id]: await readSecrets(server.id)} : {};
    const [acp] = toAcpServers([{...server, enabled: true}], secrets);
    if (!acp) {
      return {ok: false, error: 'incomplete', detail: ''};
    }
    return await testMcpServer(acp, await shellEnv());
  });
  ipcMain.handle('agent:mcpLogin', async (_evt, sessionId, serverName) => {
    try {
      await kiro.request('_kiro/mcp/resetServer', {sessionId, serverName, startOAuth: true});
      return {ok: true};
    } catch (error) {
      return {ok: false, detail: error.message};
    }
  });
  ipcMain.handle('memory:list', () => memory.all());
  ipcMain.handle('memory:save', (_evt, note, options) => memory.save(note, options));
  ipcMain.handle('memory:update', (_evt, id, patch) => memory.update(id, patch));
  ipcMain.handle('memory:remove', (_evt, id) => memory.remove(id));
  ipcMain.handle('memory:pinned', () => memory.pinned());
  ipcMain.handle('memory:prune', (_evt, days) => memory.prune(days));
  ipcMain.handle('agent:config', async () => ({
    ...DEFAULT_SETTINGS[AGENT_CONFIG],
    ...((await get(AGENT_CONFIG)) ?? {}),
  }));

  app.on('before-quit', () => {
    kiro.stop();
    mcp.stop();
  });
}
