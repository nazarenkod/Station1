export const DEFAULT_SCAN_PORTS = [4723, 4724, 4725, 4726];
const PROBE_TIMEOUT_MS = 1500;

const baseUrl = ({protocol = 'http', hostname = '127.0.0.1', port, path = ''}) =>
  `${protocol}://${hostname}:${port}${path.replace(/\/+$/, '')}`;

async function getJson(url, {method = 'GET', timeout = PROBE_TIMEOUT_MS} = {}) {
  const response = await fetch(url, {method, signal: AbortSignal.timeout(timeout)});
  const text = await response.text();
  return {ok: response.ok, status: response.status, body: text ? JSON.parse(text) : null};
}

/**
 * Reads /status of an Appium server. Appium 2 and 3 serve it at the root,
 * Appium 1 and some grids under /wd/hub.
 */
export async function probeServer(server) {
  for (const path of server.path !== undefined ? [server.path] : ['', '/wd/hub']) {
    const target = {...server, path};
    try {
      const {ok, body} = await getJson(`${baseUrl(target)}/status`);
      if (!ok) {
        continue;
      }
      const value = body?.value ?? {};
      return {
        ...target,
        url: baseUrl(target),
        reachable: true,
        version: value.build?.version ?? null,
        ready: value.ready !== false,
        message: value.message ?? '',
      };
    } catch {
      // not listening or not an Appium server: try the next path
    }
  }
  return {...server, path: server.path ?? '', url: baseUrl({...server, path: server.path ?? ''}), reachable: false};
}

/**
 * Sessions the server is running: /appium/sessions on Appium 2+, /sessions on older servers.
 * Null when the server does not tell (Appium 3 without the session_discovery feature).
 */
export async function listSessions(server) {
  for (const endpoint of ['/appium/sessions', '/sessions']) {
    try {
      const {ok, body} = await getJson(`${baseUrl(server)}${endpoint}`);
      if (ok && Array.isArray(body?.value)) {
        return body.value.map((session) => ({
          id: session.id,
          platformName: session.capabilities?.platformName ?? '',
          deviceName: session.capabilities?.['appium:deviceName'] ?? session.capabilities?.deviceName ?? '',
          udid: session.capabilities?.['appium:udid'] ?? session.capabilities?.udid ?? '',
        }));
      }
    } catch {
      // try the older endpoint
    }
  }
  return null;
}

export async function deleteSession(server, sessionId) {
  const {ok, body} = await getJson(`${baseUrl(server)}/session/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    timeout: 30000,
  });
  return {ok, error: ok ? null : (body?.value?.message ?? 'Could not delete the session')};
}

/**
 * Appium servers listening on this machine, with their sessions.
 */
export async function scanServers({ports = DEFAULT_SCAN_PORTS, extra = []} = {}) {
  const candidates = [...ports.map((port) => ({hostname: '127.0.0.1', port})), ...extra];
  const probed = await Promise.all(candidates.map(probeServer));
  const reachable = probed.filter((server) => server.reachable);
  return await Promise.all(reachable.map(async (server) => ({...server, sessions: await listSessions(server)})));
}
