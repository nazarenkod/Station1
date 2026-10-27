import {APP_DATA_PINS, LOGS_VIEW, PROXY_VIEW} from '../../../shared/setting-defs.js';
import {createSavedView} from './saved-view.js';

// the filters of the proxy and of the log, kept per profile
export const proxyView = createSavedView(PROXY_VIEW);
export const logsView = createSavedView(LOGS_VIEW);
// the keys and files pinned in the data tab, by app, kept per profile
export const appDataPins = createSavedView(APP_DATA_PINS);
