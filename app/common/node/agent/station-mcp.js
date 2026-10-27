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

/**
 * @param {object} options
 * @param {object[]} options.tools
 * @param {(conversation: string, event: object) => void} [options.onEvent] a read that hit the budget, a change
 */
export function createStationMcp({tools, onEvent = () => {}}) {
  const token = randomBytes(24).toString('hex');
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

  const handle = async (request, response) => {
    const match = /^\/mcp\/([^/?#]+)/.exec(request.url ?? '');
    if (!match) {
      response.writeHead(404).end();
      return;
    }
    if (!sameToken(request.headers.authorization, token)) {
      response.writeHead(401).end();
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
    get port() {
      return port;
    },
    readTools: new Set(tools.filter((tool) => tool.readOnly).map((tool) => tool.name)),

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
