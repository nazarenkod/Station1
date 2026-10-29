import {randomBytes, timingSafeEqual} from 'node:crypto';
import http from 'node:http';

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import {createReadBudget} from '../../shared/agent/budget.js';

// The station's own MCP server: the agent's hands. It listens on 127.0.0.1
// only and takes a request only with the token made for this run. Each
// conversation has its own address, so its read budget and what it has
// already seen are its own.
//
// A tool is {name, description, input (zod shape), readOnly, limit?, run}.
// A read tool's run gives the data; the budget decides what goes back. A
// tool that changes the station gives back its own text.

const text = (value) => ({content: [{type: 'text', text: value}]});

const sameToken = (given, expected) => {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
};

const MAX_BODY = 256 * 1024;

const readJson = (request) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('too big'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });

/**
 * @param {object} options
 * @param {object[]} options.tools
 * @param {(conversation: string, event: object) => void} [options.onEvent] a read that hit the budget, a change
 * @param {Record<string, (conversation: string, body: object) => Promise<object>>} [options.hands] what the plugin of the hands asks: `check`, `done`
 * @param {object} [options.external] what agents outside the station may read, with a token of their own
 * @param {Record<string, (args: object) => Promise<{text: string, images?: object[]}>>} options.external.tools
 * @param {() => Promise<boolean>} options.external.allowed whether the person turned access on
 * @param {(tool: string, args: object) => void} [options.external.onAccess]
 */
export function createStationMcp({tools, onEvent = () => {}, hands = {}, external = null}) {
  const token = randomBytes(24).toString('hex');
  // an external agent never gets the token of the station's own agent, nor its tools
  const externalToken = randomBytes(24).toString('hex');
  const conversations = new Map();
  let server = null;
  let port = null;

  const budgetOf = (conversation) => {
    if (!conversations.has(conversation)) {
      conversations.set(conversation, createReadBudget());
    }
    return conversations.get(conversation);
  };

  const mcpFor = (conversation) => {
    const mcp = new McpServer({name: 'station', version: '1.0.0'});
    for (const tool of tools) {
      mcp.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.input ?? {},
          annotations: {readOnlyHint: !!tool.readOnly, destructiveHint: !tool.readOnly},
        },
        async (args) => {
          try {
            const context = {conversation, budget: budgetOf(conversation)};
            const value = await tool.run(args ?? {}, context);
            if (!tool.readOnly) {
              return text(typeof value === 'string' ? value : JSON.stringify(value, null, 1));
            }
            const given = context.budget.give(tool.name, args, value, {limit: tool.limit});
            if (given.kind === 'budget') {
              onEvent(conversation, {kind: 'budget', ...context.budget.state()});
            }
            return text(given.text);
          } catch (error) {
            return {...text(`The station could not do it: ${error.message}`), isError: true};
          }
        },
      );
    }
    return mcp;
  };

  // the plugin of the agent's hands asks before and tells after each action
  const handleHands = async (request, response, conversation, op) => {
    if (request.method !== 'POST' || !Object.hasOwn(hands, op)) {
      response.writeHead(404).end();
      return;
    }
    const body = await readJson(request);
    let answer = await hands[op](conversation, body);
    if (answer?.read) {
      const budget = budgetOf(conversation);
      const given = budget.give(`hands:${body.tool}`, body.args, answer.text);
      if (given.kind === 'budget') {
        onEvent(conversation, {kind: 'budget', ...budget.state()});
      }
      answer = {text: given.text};
    }
    response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify(answer ?? {}));
  };

  // an agent outside the station: a tool by name, JSON in and out
  const handleExternal = async (request, response, name) => {
    if (!external || !sameToken(request.headers.authorization, externalToken) || !(await external.allowed())) {
      response.writeHead(403).end();
      return;
    }
    if (request.method !== 'POST' || !Object.hasOwn(external.tools, name)) {
      response.writeHead(404).end();
      return;
    }
    const args = await readJson(request);
    external.onAccess?.(name, args);
    try {
      const answer = await external.tools[name](args);
      response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({ok: true, ...answer}));
    } catch (error) {
      response
        .writeHead(200, {'content-type': 'application/json'})
        .end(JSON.stringify({ok: false, text: `The station could not do it: ${error.message}`}));
    }
  };

  const handle = async (request, response) => {
    const externalMatch = /^\/external\/(\w+)$/.exec(request.url ?? '');
    if (externalMatch) {
      await handleExternal(request, response, externalMatch[1]);
      return;
    }
    const handsMatch = /^\/hands\/([^/?#]+)\/(\w+)$/.exec(request.url ?? '');
    const match = /^\/mcp\/([^/?#]+)/.exec(request.url ?? '');
    if (!match && !handsMatch) {
      response.writeHead(404).end();
      return;
    }
    if (!sameToken(request.headers.authorization, token)) {
      response.writeHead(401).end();
      return;
    }
    if (handsMatch) {
      await handleHands(request, response, decodeURIComponent(handsMatch[1]), handsMatch[2]);
      return;
    }
    const conversation = decodeURIComponent(match[1]);
    // a server for each request, as the stateless HTTP transport wants
    const mcp = mcpFor(conversation);
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined});
    response.on('close', () => {
      transport.close();
      mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(request, response);
  };

  return {
    token,
    externalToken,
    get port() {
      return port;
    },
    // what runs without asking: tools that read, and those that only keep what the agent found
    readTools: new Set(tools.filter((tool) => tool.readOnly || tool.autoAllow).map((tool) => tool.name)),
    // the station's tools that act on the device, by the group of the project's permissions they are in
    handsGroups: new Map(tools.filter((tool) => tool.handsGroup).map((tool) => [tool.name, tool.handsGroup])),

    async start() {
      if (server) {
        return {port, token};
      }
      server = http.createServer((request, response) => {
        handle(request, response).catch(() => {
          if (!response.headersSent) {
            response.writeHead(500).end();
          }
        });
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      port = server.address().port;
      return {port, token};
    },

    /** A new turn of a conversation: its read budget starts again. */
    startTurn(conversation, {deep = false, limits = {}} = {}) {
      budgetOf(conversation).startTurn({deep, limits});
    },

    /** The person let the agent read more in this turn. */
    extend(conversation) {
      budgetOf(conversation).extend();
    },

    budget: (conversation) => budgetOf(conversation).state(),

    async stop() {
      await new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
      server = null;
    },
  };
}
