import http from 'node:http';

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {afterEach, describe, expect, it} from 'vitest';

import {mcpProblem, testMcpServer} from '../../app/common/node/agent/mcp-test.js';
import {
  cleanServer,
  cleanServers,
  secretNames,
  serverState,
  toAcpServers,
} from '../../app/common/shared/agent/mcp-servers.js';

describe('MCP servers of the agent', () => {
  it('keeps a server tidy: a kind, a name the agent can use, values of hidden fields out', () => {
    const server = cleanServer({
      name: 'Jira cloud',
      url: 'https://mcp.atlassian.com/v1/mcp',
      headers: [
        {name: 'Authorization', value: 'Bearer leaked', hidden: true},
        {name: 'X-Team', value: 'qa'},
      ],
    });
    expect(server).toMatchObject({kind: 'http', name: 'Jira-cloud', enabled: true});
    expect(server.headers).toMatchObject([
      {name: 'Authorization', value: '', hidden: true},
      {name: 'X-Team', value: 'qa', hidden: false},
    ]);
    expect(secretNames(server)).toEqual(['Authorization']);
    expect(cleanServer({name: 'station', command: 'x'}).name).toBe('station-2');
    expect(
      cleanServers([
        {name: 'a', command: 'x'},
        {name: 'a', command: 'y'},
      ]),
    ).toHaveLength(1);
  });

  it('gives Kiro the servers that are on, with the secrets put in at the last moment', () => {
    const servers = [
      {id: 'm1', name: 'jira', kind: 'http', url: 'https://mcp/x', headers: [{name: 'Authorization', hidden: true}]},
      {
        id: 'm2',
        name: 'gitlab',
        kind: 'stdio',
        command: 'npx',
        args: ['-y', 'gitlab-mcp'],
        env: [{name: 'GITLAB_TOKEN', hidden: true}],
      },
      {id: 'm3', name: 'figma', kind: 'http', url: 'https://figma/mcp', enabled: false},
      {id: 'm4', name: 'empty', kind: 'http', url: ''},
    ];
    const acp = toAcpServers(
      servers,
      {m1: {Authorization: 'Bearer t'}, m2: {GITLAB_TOKEN: 'glpat'}},
      new Set(['gitlab']),
    );
    expect(acp).toEqual([
      {type: 'http', name: 'jira', url: 'https://mcp/x', headers: [{name: 'Authorization', value: 'Bearer t'}]},
    ]);
    const local = toAcpServers(servers.slice(1, 2), {m2: {GITLAB_TOKEN: 'glpat'}});
    expect(local).toEqual([
      {name: 'gitlab', command: 'npx', args: ['-y', 'gitlab-mcp'], env: [{name: 'GITLAB_TOKEN', value: 'glpat'}]},
    ]);
  });

  it('reads Kiro’s state of a server: working, failed, needs a sign-in', () => {
    expect(serverState({status: 'connected', tools: [{name: 'a'}, {name: 'b', disabled: true}]})).toEqual({
      state: 'connected',
      tools: 1,
      error: null,
    });
    expect(serverState({status: 'failed', failedAuthorization: true})).toMatchObject({state: 'login'});
    expect(serverState(null).state).toBe('connecting');
  });

  it('names a failure in a word the settings explain', () => {
    expect(mcpProblem(new Error('HTTP 401 Unauthorized'))).toBe('auth');
    expect(mcpProblem(new Error('spawn gitlab-mcp ENOENT'))).toBe('command');
    expect(mcpProblem(new Error('fetch failed: ECONNREFUSED'))).toBe('unreachable');
  });
});

describe('«Check» next to a server', () => {
  let server;
  afterEach(() => server?.close());

  const start = async (token) => {
    server = http.createServer(async (request, response) => {
      if (request.headers.authorization !== `Bearer ${token}`) {
        response.writeHead(401).end();
        return;
      }
      const mcp = new McpServer({name: 'jira', version: '1'});
      mcp.registerTool('getIssue', {description: 'An issue by key', inputSchema: {}}, async () => ({content: []}));
      const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined});
      response.on('close', () => transport.close());
      await mcp.connect(transport);
      await transport.handleRequest(request, response);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}/mcp`;
  };

  it('connects with the token and lists the tools, or says the token is wrong', async () => {
    const url = await start('good');
    const ok = await testMcpServer({type: 'http', url, headers: [{name: 'Authorization', value: 'Bearer good'}]});
    expect(ok).toEqual({ok: true, tools: [{name: 'getIssue', description: 'An issue by key'}]});
    const refused = await testMcpServer({type: 'http', url, headers: [{name: 'Authorization', value: 'Bearer bad'}]});
    expect(refused).toMatchObject({ok: false, error: 'auth'});
  });
});
