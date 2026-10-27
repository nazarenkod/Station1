import path from 'node:path';

import {app, BrowserWindow, ipcMain} from 'electron';
import settings from 'electron-settings';

import {GitLabService} from '../../../common/node/gitlab/service.js';
import {JiraClient} from '../../../common/node/jira/client';
import {commitsWithKey, repoRoot} from '../../../common/node/source/repo.js';
import {collectTaskContext} from '../../../common/node/task/context.js';
import {createTaskStore} from '../../../common/node/task/store.js';
import {forgetTask} from '../../../common/shared/agent/conversations.js';
import {AGENT_SESSIONS, GITLAB_CONFIG, JIRA_CONFIG, TASKS} from '../../../common/shared/setting-defs.js';
import {parseTaskKey} from '../../../common/shared/task/task-text.js';
import {encryptedSecret} from '../secrets.js';

const broadcast = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
};

const jiraToken = encryptedSecret('JIRA_TOKEN_ENCRYPTED');
const gitlabToken = encryptedSecret('GITLAB_TOKEN_ENCRYPTED');

/**
 * The task each profile works on: picking it, its context gathered from
 * Jira, Confluence, GitLab and the repository, the impact analysis and the
 * ticks of its checklist.
 */
export function setupTaskIPC({station}) {
  const store = createTaskStore({
    dir: path.join(app.getPath('userData'), 'tasks'),
    get: (key) => settings.get(key),
    set: (key, value) => settings.set(key, value),
    settingKey: TASKS,
  });
  const gitlab = new GitLabService({
    getSettings: async () => (await settings.get(GITLAB_CONFIG)) ?? {},
    getToken: gitlabToken.read,
  });

  const jira = async () => {
    const config = (await settings.get(JIRA_CONFIG)) ?? {};
    const token = await jiraToken.read();
    if (!config.url || !token) {
      return null;
    }
    const client = new JiraClient({url: config.url, email: config.email, token});
    return {site: client.site, get: (requestPath) => client.get(requestPath)};
  };

  const gitlabAccess = async () => {
    try {
      const connection = await gitlab.connection();
      return {site: connection.settings.url, request: (requestPath) => gitlab.request(connection, requestPath)};
    } catch {
      return null;
    }
  };

  // the main repository of the profile, for the commits with the key
  const gitOf = async (profileId) => {
    const profile = (await station.profiles()).list.find((one) => one.id === profileId);
    const paths = await station.sourcePaths(profileId);
    const repo = profile?.source.repos.find((one) => paths[one.id]?.path);
    const root = repo ? await repoRoot(paths[repo.id].path) : null;
    return root ? {log: (key) => commitsWithKey(root, profile.source.devBranch, key)} : null;
  };

  const changed = (payload) => broadcast('task:changed', payload);

  ipcMain.handle('task:list', (_evt, profileId) => store.tasks(profileId));
  ipcMain.handle('task:setCurrent', async (_evt, profileId, input) => {
    if (!input) {
      return {ok: true, ...(await store.setCurrent(profileId, null))};
    }
    const key = parseTaskKey(input);
    if (!key) {
      return {ok: false, error: 'badKey'};
    }
    const tasks = await store.setCurrent(profileId, key);
    changed({profileId, key});
    return {ok: true, ...tasks};
  });
  ipcMain.handle('task:load', (_evt, profileId, key) => store.load(profileId, key));
  ipcMain.handle('task:refresh', async (_evt, profileId, key) => {
    const result = await collectTaskContext({
      key,
      jira: await jira(),
      gitlab: await gitlabAccess(),
      git: await gitOf(profileId),
    });
    if (!result.ok) {
      return result;
    }
    const data = await store.saveContext(profileId, key, result.context);
    changed({profileId, key});
    return {ok: true, data: (await store.load(profileId, key)) ?? data};
  });
  ipcMain.handle('task:check', (_evt, profileId, key, itemId, checked) => store.check(profileId, key, itemId, checked));
  ipcMain.handle('task:feedback', (_evt, profileId, key, itemId, kind, reason) =>
    store.feedback(profileId, key, itemId, kind, reason),
  );
  ipcMain.handle('task:forget', async (_evt, profileId, key) => {
    await store.forget(profileId, key);
    await settings.set(AGENT_SESSIONS, forgetTask((await settings.get(AGENT_SESSIONS)) ?? {}, profileId, key));
    changed({profileId, key: null});
  });

  return {
    store,
    changed,
    /** The task of the profile that is on. */
    current: async () => {
      const profiles = await station.profiles();
      return {profileId: profiles.activeId, key: (await store.tasks(profiles.activeId)).current};
    },
  };
}
