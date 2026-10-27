// Adjust locales path depending on Vite base (web vs plugin)
const viteBase = import.meta.env.BASE_URL;
const vitePath = `${viteBase.replace(/\/+$/, '')}/`;

const localesPath =
  process.env.NODE_ENV === 'development'
    ? '/locales' // 'public' folder contents are served at '/'
    : `..${vitePath}locales`; // from 'dist-browser/assets/'

const openLink = (url) => window.open(url, '');
const setTheme = () => {}; // only relevant in Electron build
const updateLanguage = () => {}; // only relevant in Electron build
const loadSessionFileIfOpened = () => null; // only relevant in Electron build

class BrowserSettings {
  has(key) {
    return this.get(key) !== null;
  }

  set(key, val) {
    return localStorage.setItem(key, JSON.stringify(val));
  }

  get(key) {
    return JSON.parse(localStorage.getItem(key));
  }
}

const settings = new BrowserSettings();

// Served by the Appium plugin, the page can reach the server's doctor; a plain
// web build cannot run local tools. Jira and AI need the desktop app's keychain.
const isPlugin = viteBase.startsWith('/inspector');
const apiRoot = `${vitePath}api/doctor`;

const api = async (path, body) => {
  const response = await fetch(`${apiRoot}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? {'Content-Type': 'application/json'} : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error ?? response.statusText);
  }
  return json;
};

const unavailable = async () => ({ok: false, error: 'Not available when the Inspector is served by the Appium plugin'});

const pluginDoctor = {
  managedServer: false,
  servers: () => api('servers'),
  deleteSession: (server, sessionId) => api('delete-session', {server, sessionId}),
  devices: () => api('devices'),
  bootDevice: (device) => api('boot', {device}),
  environment: () => api('environment'),
  driverDoctor: (driver) => api(`driver-doctor/${encodeURIComponent(driver)}`),
  getServer: async () => ({state: {status: 'stopped'}, logs: []}),
  startServer: unavailable,
  stopServer: unavailable,
  installAppium: async () => false,
  installDriver: async () => false,
  applyStress: (device, mode) => api('stress', {device, mode}),
  restoreStress: (device, mode, previous) => api('stress/restore', {device, mode, previous}),
  onServerLog: () => () => {},
  onServerState: () => () => {},
};

const backend = isPlugin
  ? {
      available: true,
      doctor: pluginDoctor,
      jira: null,
      ai: null,
      gitlab: null,
      device: null,
      builds: null,
      logs: null,
      proxy: null,
      settings: null,
      journal: null,
    }
  : {
      available: false,
      doctor: null,
      jira: null,
      ai: null,
      gitlab: null,
      device: null,
      builds: null,
      logs: null,
      proxy: null,
      settings: null,
      journal: null,
    };

export {backend, loadSessionFileIfOpened, localesPath, openLink, setTheme, settings, updateLanguage};
