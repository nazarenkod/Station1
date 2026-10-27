import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// «Check» next to an MCP server: the station connects with the server's
// authorization, lists its tools and says in a word what went wrong.

const TIMEOUT_MS = 20000;

/** A failure of a server in a word the settings turn into text. */
export function mcpProblem(error) {
  const text = `${error?.message ?? ''} ${error?.code ?? ''}`;
  if (/401|403|unauthori|forbidden|invalid.?token|auth/i.test(text)) {
    return 'auth';
  }
  if (/ENOENT|not found|spawn/i.test(text)) {
    return 'command';
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|timed out|timeout|ETIMEDOUT/i.test(text)) {
    return 'unreachable';
  }
  return 'other';
}

/**
 * @param {object} server an ACP server entry: {type: 'http', url, headers} or {command, args, env}
 * @param {object} [env] the environment a local server starts with
 * @returns {Promise<{ok: true, tools: {name: string, description: string}[]} | {ok: false, error: string, detail: string}>}
 */
export async function testMcpServer(server, env = process.env) {
  const transport =
    server.type === 'http'
      ? new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: {headers: Object.fromEntries(server.headers.map((pair) => [pair.name, pair.value]))},
        })
      : new StdioClientTransport({
          command: server.command,
          args: server.args,
          env: {...env, ...Object.fromEntries(server.env.map((pair) => [pair.name, pair.value]))},
          stderr: 'ignore',
        });
  const client = new Client({name: 'station-check', version: '1.0.0'});
  try {
    await Promise.race([
      client.connect(transport),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS)),
    ]);
    const {tools} = await client.listTools();
    return {
      ok: true,
      tools: tools.map((tool) => ({name: tool.name, description: (tool.description ?? '').slice(0, 200)})),
    };
  } catch (error) {
    return {ok: false, error: mcpProblem(error), detail: String(error?.message ?? error).slice(0, 1000)};
  } finally {
    await client.close().catch(() => null);
  }
}
