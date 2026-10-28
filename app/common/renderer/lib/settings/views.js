import {APP_DATA_PINS, LOGS_VIEW, PERF_CONFIG, PROXY_VIEW} from '../../../shared/setting-defs.js';
import {createSavedView} from './saved-view.js';

// the filters of the proxy and of the log, kept per profile
export const proxyView = createSavedView(PROXY_VIEW);
export const logsView = createSavedView(LOGS_VIEW);
// the keys and files pinned in the data tab, by app, kept per profile
export const appDataPins = createSavedView(APP_DATA_PINS);
// the project's tolerances, runs of a reference and thresholds of the Performance tab
export const perfConfig = createSavedView(PERF_CONFIG);
// a hook by its name, so the React Compiler never caches the call and skips it on a later render
export const usePerfConfig = () => perfConfig.use();
