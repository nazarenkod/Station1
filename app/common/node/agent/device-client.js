// The few W3C commands the station sends to the Inspector's session itself,
// for what must not go through the agent: typing a password, putting the
// app back to its start. The session stays the Inspector's; nothing here
// starts or ends one.

const ELEMENT_KEYS = ['element-6066-11e4-a52e-4f735466cecf', 'ELEMENT'];
const TIMEOUT_MS = 30000;

export class DeviceError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/**
 * @param {{serverUrl: string, sessionId: string, platform: 'android' | 'ios'}} session
 * @param {typeof fetch} [fetchImpl]
 */
export function createDeviceClient({serverUrl, sessionId, platform}, fetchImpl = fetch) {
  const base = `${String(serverUrl).replace(/\/+$/, '')}/session/${encodeURIComponent(sessionId)}`;
  const ios = platform === 'ios';
  const appKey = ios ? 'bundleId' : 'appId';

  const request = async (method, path, body) => {
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers: {'content-type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new DeviceError(`Appium did not answer: ${error.message}`, 'unreachable');
    }
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.value?.error) {
      throw new DeviceError(
        json?.value?.message ?? `Appium answered ${response.status}`,
        json?.value?.error ?? 'failed',
      );
    }
    return json.value;
  };

  const execute = (script, args) => request('POST', '/execute/sync', {script, args: [args]});

  return {
    source: () => request('GET', '/source'),

    /** The element a locator finds, or null when there is none. */
    async find({using, value}) {
      try {
        const found = await request('POST', '/element', {using, value});
        return ELEMENT_KEYS.map((key) => found?.[key]).find(Boolean) ?? null;
      } catch (error) {
        if (error.code === 'no such element') {
          return null;
        }
        throw error;
      }
    },

    click: (id) => request('POST', `/element/${id}/click`, {}),
    clear: (id) => request('POST', `/element/${id}/clear`, {}),
    type: (id, text) => request('POST', `/element/${id}/value`, {text, value: [...text]}),

    terminate: (appId) => execute('mobile: terminateApp', {[appKey]: appId}),
    activate: (appId) => execute('mobile: activateApp', {[appKey]: appId}),
    clearApp: (appId) => execute('mobile: clearApp', {[appKey]: appId}),
    deepLink: (url, appId) => execute('mobile: deepLink', ios ? {url, bundleId: appId} : {url, package: appId}),
  };
}
