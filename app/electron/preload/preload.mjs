import {ipcRenderer, webUtils} from 'electron';

// Subscribes to a main process event; returns the function that unsubscribes
const subscribe = (channel) => (callback) => {
  const listener = (_evt, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

// the macOS window has no title bar: the app header leaves room for the window buttons
if (process.platform === 'darwin') {
  window.addEventListener('DOMContentLoaded', () => document.body.classList.add('mac-inset'));
}

window.electronIPC = {
  hasSetting: async (key) => await ipcRenderer.invoke('settings:has', key),
  setSetting: async (key, val) => await ipcRenderer.invoke('settings:set', key, val),
  getSetting: async (key) => await ipcRenderer.invoke('settings:get', key),
  openLink: (link) => ipcRenderer.send('electron:openLink', link),
  setTheme: (theme) => ipcRenderer.send('electron:setTheme', theme),
  updateLanguage: (lngCode) => ipcRenderer.send('electron:updateLanguage', lngCode),
  loadSessionFileIfOpened: async () => await ipcRenderer.invoke('sessionfile:loadIfOpened'),
  doctor: {
    managedServer: true,
    servers: async (options) => await ipcRenderer.invoke('doctor:servers', options),
    deleteSession: async (server, sessionId) => await ipcRenderer.invoke('doctor:deleteSession', server, sessionId),
    devices: async () => await ipcRenderer.invoke('doctor:devices'),
    bootDevice: async (device) => await ipcRenderer.invoke('doctor:bootDevice', device),
    environment: async () => await ipcRenderer.invoke('doctor:environment'),
    driverDoctor: async (driver) => await ipcRenderer.invoke('doctor:driverDoctor', driver),
    getServer: async () => await ipcRenderer.invoke('doctor:server:get'),
    startServer: async (options) => await ipcRenderer.invoke('doctor:server:start', options),
    stopServer: async () => await ipcRenderer.invoke('doctor:server:stop'),
    installAppium: async (drivers) => await ipcRenderer.invoke('doctor:server:install', drivers),
    installDriver: async (driver) => await ipcRenderer.invoke('doctor:server:installDriver', driver),
    applyStress: async (device, mode) => await ipcRenderer.invoke('doctor:stress:apply', device, mode),
    restoreStress: async (device, mode, previous) =>
      await ipcRenderer.invoke('doctor:stress:restore', device, mode, previous),
    onServerLog: subscribe('doctor:server:log'),
    onServerState: subscribe('doctor:server:state'),
  },
  jira: {
    hasToken: async () => await ipcRenderer.invoke('jira:hasToken'),
    setToken: async (token) => await ipcRenderer.invoke('jira:setToken', token),
    test: async () => await ipcRenderer.invoke('jira:test'),
    mine: async () => await ipcRenderer.invoke('jira:mine'),
    findUsers: async (query) => await ipcRenderer.invoke('jira:findUsers', query),
    prepare: async (request) => await ipcRenderer.invoke('jira:prepare', request),
    file: async (request) => await ipcRenderer.invoke('jira:file', request),
    lookup: async (request) => await ipcRenderer.invoke('jira:lookup', request),
    link: async (request) => await ipcRenderer.invoke('jira:link', request),
    unlink: async (request) => await ipcRenderer.invoke('jira:unlink', request),
  },
  ai: {
    status: async () => await ipcRenderer.invoke('ai:status'),
    hasKey: async () => await ipcRenderer.invoke('ai:hasKey'),
    setKey: async (key) => await ipcRenderer.invoke('ai:setKey', key),
    generate: async (request) => await ipcRenderer.invoke('ai:generate', request),
    test: async () => await ipcRenderer.invoke('ai:test'),
  },
  gitlab: {
    hasToken: async () => await ipcRenderer.invoke('gitlab:hasToken'),
    setToken: async (token) => await ipcRenderer.invoke('gitlab:setToken', token),
    test: async () => await ipcRenderer.invoke('gitlab:test'),
  },
  device: {
    apps: async (device) => await ipcRenderer.invoke('device:apps', device),
    foreground: async (device) => await ipcRenderer.invoke('device:foreground', device),
    appVersion: async (device, appId) => await ipcRenderer.invoke('device:appVersion', device, appId),
  },
  builds: {
    // a dropped file only tells its path through webUtils
    pathForFile: (file) => webUtils.getPathForFile(file),
    pick: async () => await ipcRenderer.invoke('builds:pick'),
    inspect: async (file) => await ipcRenderer.invoke('builds:inspect', file),
    install: async (device, file, options) => await ipcRenderer.invoke('builds:install', device, file, options),
    uninstall: async (device, appId) => await ipcRenderer.invoke('builds:uninstall', device, appId),
    gitlabList: async () => await ipcRenderer.invoke('builds:gitlab:list'),
    gitlabFetch: async (jobId) => await ipcRenderer.invoke('builds:gitlab:fetch', jobId),
    gitlabExtract: async (jobId, candidate) => await ipcRenderer.invoke('builds:gitlab:extract', jobId, candidate),
    onProgress: subscribe('builds:progress'),
  },
  logs: {
    start: async (device, appId, rules) => await ipcRenderer.invoke('logs:start', device, appId, rules),
    stop: async () => await ipcRenderer.invoke('logs:stop'),
    snapshot: async () => await ipcRenderer.invoke('logs:snapshot'),
    setApp: async (appId) => await ipcRenderer.invoke('logs:setApp', appId),
    setRules: async (rules) => await ipcRenderer.invoke('logs:setRules', rules),
    clear: async () => await ipcRenderer.invoke('logs:clear'),
    save: async (name) => await ipcRenderer.invoke('logs:save', name),
    onBatch: subscribe('logs:batch'),
  },
  proxy: {
    start: async (options) => await ipcRenderer.invoke('proxy:start', options),
    stop: async () => await ipcRenderer.invoke('proxy:stop'),
    snapshot: async () => await ipcRenderer.invoke('proxy:snapshot'),
    setMockRules: async (rules) => await ipcRenderer.invoke('proxy:setMockRules', rules),
    setModes: async (modes) => await ipcRenderer.invoke('proxy:setModes', modes),
    setTrafficRules: async (rules) => await ipcRenderer.invoke('proxy:setTrafficRules', rules),
    clear: async () => await ipcRenderer.invoke('proxy:clear'),
    resume: async (pauseId, decision) => await ipcRenderer.invoke('proxy:resume', pauseId, decision),
    replay: async (request) => await ipcRenderer.invoke('proxy:replay', request),
    revealCa: async () => await ipcRenderer.invoke('proxy:revealCa'),
    exportHar: async (ids, name) => await ipcRenderer.invoke('proxy:exportHar', ids, name),
    connectDevice: async (device) => await ipcRenderer.invoke('proxy:connectDevice', device),
    disconnectDevice: async (device) => await ipcRenderer.invoke('proxy:disconnectDevice', device),
    deviceState: async (device) => await ipcRenderer.invoke('proxy:deviceState', device),
    macProxy: async (enable) => await ipcRenderer.invoke('proxy:macProxy', enable),
    macProxyState: async () => await ipcRenderer.invoke('proxy:macProxyState'),
    onBatch: subscribe('proxy:batch'),
  },
};
