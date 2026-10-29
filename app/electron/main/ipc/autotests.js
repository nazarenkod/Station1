import os from 'node:os';
import path from 'node:path';

import {app, BrowserWindow, ipcMain} from 'electron';
import settings from 'electron-settings';

import {externalTools} from '../../../common/node/autotests/external-run.js';
import {removeConnection, writeConnection} from '../../../common/node/autotests/external.js';
import {createPackagesStore} from '../../../common/node/autotests/packages.js';
import {inspectAutotests, readRules} from '../../../common/node/autotests/repo.js';
import {journal} from '../../../common/node/journal.js';
import {compileMasks, DEFAULT_MASK_PATTERNS} from '../../../common/shared/agent/privacy.js';
import {cleanAutotestsConfig} from '../../../common/shared/autotests/config.js';
import {generationPrompt, parseGenerated} from '../../../common/shared/autotests/screen-objects.js';
import {AI_CONFIG, AUTOTESTS_CONFIG, DEFAULT_SETTINGS, EXTERNAL_AGENTS} from '../../../common/shared/setting-defs.js';
import {shortPath} from '../../../common/shared/settings/source.js';

const broadcast = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
};

/**
 * The project's autotests: its repository on this Mac, the packages of
 * screen objects saved after sessions, the code the agent writes for them,
 * and access for the test agent outside the station. Set up before the
 * agent, whose MCP server serves that access; `attach` gets the agent then.
 */
export function setupAutotestsIPC({station}) {
  const dataDir = app.getPath('userData');
  const packages = createPackagesStore(path.join(dataDir, 'autotests'));
  const get = async (key) => (await settings.get(key)) ?? DEFAULT_SETTINGS[key];
  const masks = async () => compileMasks((await settings.get(AI_CONFIG))?.maskPatterns ?? DEFAULT_MASK_PATTERNS);
  const active = async () => (await station.profiles()).activeId;
  let agent = null;
  let mcp = null;

  station.onProfileRemoved((profileId) => packages.removeProject(profileId));

  const inspect = async () => {
    const profileId = await active();
    const folder = await station.autotestsPath(profileId);
    return {
      path: folder,
      shown: shortPath(folder, os.homedir()),
      ...(await inspectAutotests(folder, await get(AUTOTESTS_CONFIG))),
    };
  };

  ipcMain.handle('autotests:inspect', inspect);
  ipcMain.handle('autotests:setPath', async (_evt, folder) => {
    await station.setAutotestsPath(await active(), folder || null);
    return await inspect();
  });

  ipcMain.handle('autotests:packages', async () => await packages.list(await active()));
  ipcMain.handle('autotests:package', async (_evt, id) => await packages.get(await active(), id));
  ipcMain.handle('autotests:shot', async (_evt, id, file) => await packages.shot(await active(), id, file));
  ipcMain.handle('autotests:save', async (_evt, pack) => {
    const saved = await packages.save(await active(), pack);
    broadcast('autotests:changed', {});
    return saved;
  });
  ipcMain.handle('autotests:update', async (_evt, id, patch) => {
    // only what a person changes by hand: the name of the package or of a screen object, the ready mark
    const pack = await packages.update(await active(), id, (kept) => ({
      ...kept,
      name: typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : kept.name,
      ready: typeof patch.ready === 'boolean' ? patch.ready : kept.ready,
      objects: kept.objects.map((object) =>
        patch.objectNames?.[object.id]?.trim() ? {...object, name: patch.objectNames[object.id].trim()} : object,
      ),
    }));
    broadcast('autotests:changed', {});
    return pack;
  });
  ipcMain.handle('autotests:remove', async (_evt, id) => {
    await packages.remove(await active(), id);
    broadcast('autotests:changed', {});
  });

  /**
   * The code of the screen objects of a package (all, or the ones named),
   * written by the agent from the team's rules in the autotests repository.
   */
  ipcMain.handle('autotests:generate', async (_evt, id, {objectIds = null, hint = '', confirmCredits = false} = {}) => {
    const profileId = await active();
    const pack = await packages.get(profileId, id);
    if (!pack) {
      return {ok: false, error: 'noPackage'};
    }
    const repo = await inspect();
    if (!repo.ok || repo.missing.length) {
      return {ok: false, error: 'missing', missing: repo.missing};
    }
    if (!agent) {
      return {ok: false, error: 'stopped'};
    }
    const objects = pack.objects.filter((object) => !objectIds || objectIds.includes(object.id));
    const config = cleanAutotestsConfig(await get(AUTOTESTS_CONFIG));
    const prompt = generationPrompt({
      rules: await readRules(repo.root, config),
      rulesPath: config.rules,
      examplesPath: config.examples,
      platform: pack.platform,
      app: pack.app,
      objects,
      hint: String(hint ?? '').trim(),
      masks: await masks(),
    });
    const answer = await agent.generate({profileId, cwd: repo.root, prompt, confirmCredits});
    if (!answer.ok) {
      return answer;
    }
    const code = parseGenerated(
      answer.text,
      objects.map((object) => object.name),
    );
    const written = Object.keys(code).length;
    if (!written) {
      return {ok: false, error: 'noCode', detail: answer.text.slice(0, 2000)};
    }
    const at = new Date().toISOString();
    await packages.update(profileId, id, (kept) => ({
      ...kept,
      objects: kept.objects.map((object) =>
        code[object.name] ? {...object, code: code[object.name], generatedAt: at, hint: hint || null} : object,
      ),
    }));
    broadcast('autotests:changed', {});
    return {ok: true, written, asked: objects.length};
  });

  // ---- the test agent outside the station

  const external = async () => ({
    ...DEFAULT_SETTINGS[EXTERNAL_AGENTS],
    ...((await settings.get(EXTERNAL_AGENTS)) ?? {}),
  });

  // the file the bridge finds the station by is there only while access is on
  const syncConnection = async () => {
    if (!mcp) {
      return;
    }
    if ((await external()).enabled) {
      const {port} = await mcp.start();
      await writeConnection(dataDir, {port, token: mcp.externalToken});
    } else {
      await removeConnection(dataDir);
    }
  };

  ipcMain.handle('autotests:external', async () => ({
    ...(await external()),
    dataDir,
    // in development the bridge is the CLI built next to the app
    cli: path.join(app.getAppPath(), 'dist-cli', 'vision-inspector.mjs'),
    node: app.isPackaged ? null : process.execPath,
  }));
  ipcMain.handle('autotests:setExternal', async (_evt, enabled) => {
    await settings.set(EXTERNAL_AGENTS, {...(await external()), enabled: !!enabled});
    await syncConnection();
    return await external();
  });

  app.on('before-quit', () => {
    removeConnection(dataDir).catch(() => null);
  });

  return {
    /** What the station's MCP server gives an agent outside it. */
    external: {
      tools: externalTools({packages, profiles: () => station.profiles(), masks}),
      allowed: async () => (await external()).enabled,
      onAccess: async (tool, args) => {
        // whatever an agent outside the station reads is seen in the station's journal
        journal.add({level: 'info', text: `external agent: ${tool}`, detail: JSON.stringify(args)});
        await settings.set(EXTERNAL_AGENTS, {
          ...(await external()),
          lastAccess: new Date().toISOString(),
          lastTool: tool,
        });
        broadcast('autotests:changed', {});
      },
    },
    /** The agent is up: generation can run, and access opens if it is on. */
    attach({service, mcp: server}) {
      agent = service;
      mcp = server;
      syncConnection().catch(() => null);
    },
  };
}
