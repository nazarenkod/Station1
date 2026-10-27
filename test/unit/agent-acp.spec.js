import {PassThrough} from 'node:stream';

import {describe, expect, it} from 'vitest';

import {AcpClient} from '../../app/common/node/agent/acp-client.js';
import {kiroProblem} from '../../app/common/node/agent/kiro.js';
import {
  addUserMessage,
  applyUpdate,
  chatCredits,
  emptyChat,
  turnCredits,
} from '../../app/common/shared/agent/acp-events.js';
import {decidePermission, readOnlyCommand} from '../../app/common/shared/agent/permissions.js';

const apply = (updates) => updates.reduce(applyUpdate, emptyChat());

describe('the chat from Kiro updates', () => {
  it('joins streamed text into one message and starts a new one after a tool', () => {
    const chat = apply([
      {sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: 'Це '}},
      {sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: '422.'}},
      {
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: '@station/traffic_get',
        status: 'pending',
        rawInput: {tool_id: 'station::traffic_get', arguments: {id: 'x'}},
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        status: 'completed',
        content: [{type: 'content', content: {type: 'text', text: 'a'.repeat(400)}}],
      },
      {sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: 'Готово'}},
    ]);
    expect(chat.items.map((item) => item.type)).toEqual(['agent', 'tool', 'agent']);
    expect(chat.items[0].text).toBe('Це 422.');
    expect(chat.items[1]).toMatchObject({server: 'station', tool: 'traffic_get', status: 'completed', chars: 400});
  });

  it('skips a tool that was only loaded, never called', () => {
    const chat = apply([
      {sessionUpdate: 'tool_call_update', toolCallId: 'load', status: 'completed', title: 'Tool Load'},
    ]);
    expect(chat.items).toEqual([]);
  });

  it('skips Kiro’s own steps, like reading its cloud config', () => {
    const chat = apply([
      {sessionUpdate: 'tool_call', toolCallId: 'cfg', title: 'Fetching your cloud config', status: 'completed'},
    ]);
    expect(chat.items).toEqual([]);
  });

  it('skips Kiro loading tool descriptions when a conversation is replayed', () => {
    const chat = apply([
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'load',
        title: 'Tool Load',
        rawInput: {tool_ids: ['station::station_state']},
      },
      {sessionUpdate: 'tool_call_update', toolCallId: 'load', status: 'completed'},
    ]);
    expect(chat.items).toEqual([]);
  });

  it('closes a turn with its credits, time and the context its tools took', () => {
    const chat = apply([
      {sessionUpdate: 'tool_call', toolCallId: 't1', title: '@station/station_state', status: 'pending'},
      {sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', rawOutput: {message: 'abc'}},
      {
        sessionUpdate: 'session_info_update',
        _meta: {
          kiro: {
            kind: 'turn_completion',
            turnId: 'turn-a',
            elapsedTime: 2383,
            status: 'success',
            promptTurnSummaries: [{unit: 'credit', unitPlural: 'credits', usage: 0.0579}],
          },
        },
      },
    ]);
    const turn = chat.items.at(-1);
    expect(turn).toMatchObject({type: 'turn', credits: 0.0579, ms: 2383, toolChars: 17});
    expect(chatCredits(chat)).toBeCloseTo(0.0579);
  });

  it('says nothing about credits rather than zero when Kiro sent no metering', () => {
    expect(turnCredits(undefined)).toBeNull();
    expect(turnCredits([{unit: 'token', usage: 10}])).toBeNull();
    const chat = apply([{sessionUpdate: 'session_info_update', _meta: {kiro: {kind: 'turn_completion'}}}]);
    expect(chat.items[0].credits).toBeNull();
    expect(chatCredits(chat)).toBeNull();
  });

  it('keeps how full the context is and what fills it', () => {
    const chat = apply([
      {
        sessionUpdate: 'session_info_update',
        _meta: {
          kiro: {
            kind: 'context_usage',
            usagePercentage: 63.5,
            summarizationThreshold: 80,
            breakdown: {tools: {mcp: {tokens: 900}}},
          },
        },
      },
    ]);
    expect(chat.context).toEqual({percent: 63.5, threshold: 80, breakdown: {tools: {mcp: {tokens: 900}}}});
  });

  it('shows the person’s message before Kiro answers and a replayed one after a load', () => {
    const sent = addUserMessage(emptyChat(), 'чому 422?', [{kind: 'request', id: 'r1', label: 'POST /t 422'}]);
    expect(sent.items[0]).toMatchObject({type: 'user', text: 'чому 422?', chips: [{id: 'r1'}]});
    expect(sent.busy).toBe(true);
    const replay = apply([
      {sessionUpdate: 'user_message_chunk', content: {type: 'text', text: 'привіт'}},
      {sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: 'вітаю'}},
    ]);
    expect(replay.items.map((item) => item.type)).toEqual(['user', 'agent']);
  });
});

describe('the ACP connection', () => {
  const pair = (onRequest) => {
    const toAgent = new PassThrough();
    const fromAgent = new PassThrough();
    const client = new AcpClient({stdin: toAgent, stdout: fromAgent}, onRequest);
    const sent = [];
    toAgent.on('data', (chunk) =>
      sent.push(
        ...String(chunk)
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line)),
      ),
    );
    const say = (message) => fromAgent.write(`${JSON.stringify(message)}\n`);
    return {client, sent, say};
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  it('answers a request with the result of the same id, and an error as an error', async () => {
    const {client, sent, say} = pair();
    const first = client.request('initialize', {protocolVersion: 1});
    const second = client.request('session/new', {});
    await tick();
    expect(sent.map((message) => message.method)).toEqual(['initialize', 'session/new']);
    say({jsonrpc: '2.0', id: sent[1].id, error: {code: -32602, message: 'bad'}});
    say({jsonrpc: '2.0', id: sent[0].id, result: {protocolVersion: 1}});
    await expect(first).resolves.toEqual({protocolVersion: 1});
    await expect(second).rejects.toThrow('bad');
  });

  it('passes notifications on and skips lines that are not JSON', async () => {
    const {client, say} = pair();
    const seen = [];
    client.on('notification', (method, params) => seen.push([method, params]));
    say({jsonrpc: '2.0', method: 'session/update', params: {sessionId: 's', update: {}}});
    await tick();
    expect(seen).toEqual([['session/update', {sessionId: 's', update: {}}]]);
  });

  it('answers what the agent asks, and refuses what nobody handles instead of keeping silent', async () => {
    const {sent, say} = pair(async (method) => {
      if (method === 'session/request_permission') {
        return {outcome: {outcome: 'selected', optionId: 'accept'}};
      }
      throw Object.assign(new Error('no'), {code: -32601});
    });
    say({jsonrpc: '2.0', id: 7, method: 'session/request_permission', params: {}});
    say({jsonrpc: '2.0', id: 8, method: 'fs/read_text_file', params: {}});
    await tick();
    expect(sent).toContainEqual({jsonrpc: '2.0', id: 7, result: {outcome: {outcome: 'selected', optionId: 'accept'}}});
    expect(sent).toContainEqual({jsonrpc: '2.0', id: 8, error: {code: -32601, message: 'no'}});
  });

  it('fails what waits when the process is gone', async () => {
    const {client} = pair();
    const waiting = client.request('session/prompt', {});
    client.close('The agent stopped (exit 1)');
    await expect(waiting).rejects.toThrow('exit 1');
    await expect(client.request('x')).rejects.toThrow('not running');
  });

  it('names what went wrong in a word the chat explains', () => {
    expect(kiroProblem(Object.assign(new Error('spawn kiro-cli ENOENT'), {code: 'ENOENT'}))).toBe('missing');
    expect(kiroProblem(new Error('Unauthorized: please login'))).toBe('login');
    expect(kiroProblem(new Error('Monthly usage limit exceeded'))).toBe('credits');
    expect(kiroProblem(new Error('getaddrinfo ENOTFOUND app.kiro.dev'))).toBe('network');
    expect(kiroProblem(new Error('The agent stopped (exit 1)'))).toBe('stopped');
  });
});

describe('permissions the station answers itself', () => {
  const options = [
    {optionId: 'accept', kind: 'allow_once'},
    {optionId: 'always-accept', kind: 'allow_always'},
    {optionId: 'reject', kind: 'reject_once'},
  ];
  const readTools = new Set(['traffic_get', 'station_state']);
  const mcp = (serverName, toolName) => ({
    options,
    toolCall: {title: `@${serverName}/${toolName}`},
    _meta: {kiro: {consent: {capability: 'mcp'}, mcpTool: {identity: {serverName, toolName}}}},
  });
  const shell = (command) => ({
    options,
    toolCall: {kind: 'execute', rawInput: {command}},
    _meta: {kiro: {consent: {capability: 'shell', resource: command}}},
  });

  it('lets the station’s read tools through and asks the person about its changes', () => {
    expect(decidePermission(mcp('station', 'traffic_get'), {readTools})).toEqual({
      action: 'allow',
      optionId: 'accept',
      reason: 'stationRead',
    });
    expect(decidePermission(mcp('station', 'proxy_mock_set'), {readTools}).action).toBe('ask');
  });

  it('asks the person about any tool of another MCP server', () => {
    expect(decidePermission(mcp('jira', 'getIssue'), {readTools}).action).toBe('ask');
  });

  it('lets git and shell commands that only read through, refuses the rest', () => {
    expect(decidePermission(shell('git log --oneline develop..feature/PAY-1'), {readTools}).action).toBe('allow');
    expect(decidePermission(shell('git diff develop...HEAD -- src | head -200'), {readTools}).action).toBe('allow');
    expect(decidePermission(shell('git checkout feature/PAY-1'), {readTools}).action).toBe('reject');
    expect(decidePermission(shell('rm -rf build'), {readTools}).action).toBe('reject');
    expect(decidePermission(shell('cat a > b'), {readTools}).action).toBe('reject');
    expect(readOnlyCommand('find . -name "*.kt" -exec rm {} \\;')).toBe(false);
    expect(readOnlyCommand('rg "purpose" app/src')).toBe(true);
  });

  it('refuses writing files and never picks an option Kiro did not offer', () => {
    const write = {options, toolCall: {kind: 'edit'}, _meta: {kiro: {consent: {capability: 'write'}}}};
    expect(decidePermission(write, {readTools})).toMatchObject({action: 'reject', optionId: 'reject'});
    const noReject = {...write, options: [{optionId: 'accept', kind: 'allow_once'}]};
    expect(decidePermission(noReject, {readTools}).action).toBe('ask');
  });
});
