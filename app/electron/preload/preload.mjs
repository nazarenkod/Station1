import {ipcRenderer} from 'electron';

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
    issue: async (key) => await ipcRenderer.invoke('jira:issue', key),
    findUsers: async (query) => await ipcRenderer.invoke('jira:findUsers', query),
    prepare: async (request) => await ipcRenderer.invoke('jira:prepare', request),
    file: async (request) => await ipcRenderer.invoke('jira:file', request),
  },
};
