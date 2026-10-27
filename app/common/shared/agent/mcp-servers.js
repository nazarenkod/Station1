// The MCP servers the agent gets besides the station's own: for the whole
// station or for one project, local (a command) or remote (an address).
// Their secrets (tokens in headers, keys in the environment) live in the
// keychain; here a hidden field only says that it is one.

export const SERVER_KINDS = ['stdio', 'http'];
export const STATION_SERVER = 'station';

const newServerId = () => `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const pairs = (list) =>
  (Array.isArray(list) ? list : [])
    .map((pair) => ({
      // the settings tell the rows apart by it
      id: String(pair?.id ?? '') || Math.random().toString(36).slice(2, 9),
      name: String(pair?.name ?? '').trim(),
      // "hidden", not "secret": the export drops fields named like secrets, and this flag must travel
      value: pair?.hidden ? '' : String(pair?.value ?? ''),
      hidden: !!pair?.hidden,
    }))
    .filter((pair) => pair.name || pair.id);

/** A server as it is kept: a name the agent sees, how to reach it, whether it is on. */
export function cleanServer(server) {
  const kind = SERVER_KINDS.includes(server?.kind) ? server.kind : server?.url ? 'http' : 'stdio';
  const name =
    String(server?.name ?? '')
      .trim()
      .replace(/[^\w.-]+/g, '-') || 'server';
  return {
    id: String(server?.id ?? '').trim() || newServerId(),
    name: name === STATION_SERVER ? `${name}-2` : name,
    kind,
    command: kind === 'stdio' ? String(server?.command ?? '').trim() : '',
    args: kind === 'stdio' ? (Array.isArray(server?.args) ? server.args.map(String) : []) : [],
    url: kind === 'http' ? String(server?.url ?? '').trim() : '',
    env: kind === 'stdio' ? pairs(server?.env) : [],
    headers: kind === 'http' ? pairs(server?.headers) : [],
    oauth: kind === 'http' && !!server?.oauth,
    enabled: server?.enabled !== false,
  };
}

/** Servers without repeated names; the first one wins. */
export function cleanServers(list) {
  const names = new Set();
  return (Array.isArray(list) ? list : []).map(cleanServer).filter((server) => {
    if (names.has(server.name)) {
      return false;
    }
    names.add(server.name);
    return true;
  });
}

/** The names of the secret fields of a server, to ask the keychain for. */
export const secretNames = (server) =>
  [...server.env, ...server.headers].filter((pair) => pair.hidden && pair.name).map((pair) => pair.name);

// a row the person left without a name is not sent
const withSecrets = (list, secrets) =>
  list
    .filter((pair) => pair.name)
    .map((pair) => ({name: pair.name, value: pair.hidden ? (secrets?.[pair.name] ?? '') : pair.value}));

/**
 * The servers as ACP `session/new` takes them, with their secrets put in
 * at the last moment. A server whose secret is missing still goes: it fails
 * on its own and the person sees why.
 * @param {object[]} servers
 * @param {Record<string, Record<string, string>>} secrets by server id, then field name
 * @param {Set<string>} [off] names switched off for this conversation
 */
export function toAcpServers(servers, secrets = {}, off = new Set()) {
  return cleanServers(servers)
    .filter((server) => server.enabled && !off.has(server.name))
    .filter((server) => (server.kind === 'http' ? server.url : server.command))
    .map((server) =>
      server.kind === 'http'
        ? {type: 'http', name: server.name, url: server.url, headers: withSecrets(server.headers, secrets[server.id])}
        : {
            name: server.name,
            command: server.command,
            args: server.args,
            env: withSecrets(server.env, secrets[server.id]),
          },
    );
}

/** The station's own server for one conversation. */
export function stationServer({port, token, conversation}) {
  return {
    type: 'http',
    name: STATION_SERVER,
    url: `http://127.0.0.1:${port}/mcp/${encodeURIComponent(conversation)}`,
    headers: [{name: 'Authorization', value: `Bearer ${token}`}],
  };
}

/**
 * A server's state as the settings show it, from Kiro's `_kiro/mcp/status`.
 * @returns {{state: 'connected' | 'failed' | 'login' | 'disabled' | 'connecting', tools: number, error: string | null}}
 */
export function serverState(status) {
  if (!status) {
    return {state: 'connecting', tools: 0, error: null};
  }
  const tools = Array.isArray(status.tools) ? status.tools.filter((tool) => !tool.disabled).length : 0;
  if (status.failedAuthorization) {
    return {state: 'login', tools, error: null};
  }
  const state = ['connected', 'failed', 'disabled'].includes(status.status) ? status.status : 'connecting';
  return {state, tools, error: status.error ?? status.message ?? null};
}
