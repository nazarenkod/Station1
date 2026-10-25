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

// A browser page cannot run local tools or keep credentials: the doctor, Jira
// and AI are only offered by the desktop app
const backend = {available: false, doctor: null, jira: null, ai: null};

export {backend, loadSessionFileIfOpened, localesPath, openLink, setTheme, settings, updateLanguage};
