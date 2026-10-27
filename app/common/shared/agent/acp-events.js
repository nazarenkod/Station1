// A conversation as the chat shows it, made from the session updates Kiro
// sends over ACP: the person's messages, the agent's text, its tool calls
// with how much each one put into the context, the credits of each turn,
// and how full the context is. Unknown updates are ignored.

// steps Kiro shows of its own work, not calls of the agent: loading tools, reading its cloud config
const KIRO_HOUSEKEEPING = /^(Tool Load|Fetching your cloud config.*)$/i;

export const emptyChat = () => ({items: [], context: null, title: null, busy: false});

const text = (content) => (content?.type === 'text' ? (content.text ?? '') : '');

// how many characters a tool gave back: this stays in the context
function outputChars(update) {
  const parts = (update.content ?? []).map((part) => text(part.content ?? part));
  const joined = parts.join('');
  if (joined) {
    return joined.length;
  }
  const raw = update.rawOutput;
  return raw ? (typeof raw === 'string' ? raw : JSON.stringify(raw)).length : 0;
}

/** The credits of a finished turn, or null when Kiro sent no metering. */
export function turnCredits(summaries) {
  const credits = (summaries ?? []).filter((summary) => summary?.unit === 'credit');
  if (!credits.length) {
    return null;
  }
  return credits.reduce((sum, summary) => sum + (Number(summary.usage) || 0), 0);
}

// the server and tool name of an MCP call; built-in tools have neither
function toolIdentity(update) {
  const id = update.rawInput?.tool_id;
  if (typeof id === 'string' && id.includes('::')) {
    const [server, tool] = id.split('::');
    return {server, tool};
  }
  const server = update._meta?.kiro?.serverName;
  const title = String(update.title ?? '');
  const match = /^@([^/]+)\/(.+)$/.exec(title);
  return match ? {server: match[1], tool: match[2]} : {server: server ?? null, tool: null};
}

const appendText = (items, type, chunk, extra = {}) => {
  const last = items.at(-1);
  if (last?.type === type && !last.closed) {
    return [...items.slice(0, -1), {...last, text: last.text + chunk}];
  }
  return [...items, {type, id: `${type}-${items.length}`, text: chunk, ...extra}];
};

/**
 * One session update applied to the chat.
 * @param {ReturnType<typeof emptyChat>} chat
 * @param {object} update the `update` of a `session/update` notification
 */
export function applyUpdate(chat, update) {
  switch (update?.sessionUpdate) {
    case 'user_message_chunk':
      return {...chat, items: appendText(chat.items, 'user', text(update.content), {replay: true})};
    case 'agent_message_chunk':
      return {...chat, items: appendText(chat.items, 'agent', text(update.content))};
    case 'tool_call': {
      // Kiro loading the descriptions of tools is its own bookkeeping, not a call
      if (KIRO_HOUSEKEEPING.test(update.title ?? '') || Array.isArray(update.rawInput?.tool_ids)) {
        return chat;
      }
      const {server, tool} = toolIdentity(update);
      const item = {
        type: 'tool',
        id: update.toolCallId,
        title: update.title ?? tool ?? '',
        server,
        tool,
        kind: update.kind ?? null,
        status: update.status ?? 'pending',
        chars: 0,
      };
      const known = chat.items.some((one) => one.type === 'tool' && one.id === update.toolCallId);
      return {
        ...chat,
        items: known
          ? chat.items.map((one) => (one.type === 'tool' && one.id === update.toolCallId ? {...one, ...item} : one))
          : [...chat.items, item],
      };
    }
    case 'tool_call_update': {
      const known = chat.items.some((one) => one.type === 'tool' && one.id === update.toolCallId);
      // a tool the agent only loaded, not called, is not worth a line
      if (!known) {
        return chat;
      }
      return {
        ...chat,
        items: chat.items.map((one) =>
          one.type === 'tool' && one.id === update.toolCallId
            ? {
                ...one,
                status: update.status ?? one.status,
                title: update.title ?? one.title,
                chars: update.status === 'completed' || update.status === 'failed' ? outputChars(update) : one.chars,
                failure: update._meta?.kiro?.failureReason ?? one.failure ?? null,
              }
            : one,
        ),
      };
    }
    case 'session_info_update':
      return applyInfo(chat, update);
    default:
      return chat;
  }
}

function applyInfo(chat, update) {
  const kiro = update._meta?.kiro ?? {};
  const next = update.title ? {...chat, title: update.title} : chat;
  switch (kiro.kind) {
    case 'context_usage':
      return {
        ...next,
        context: {
          percent: Number(kiro.usagePercentage ?? kiro.contextUsage?.usagePercentage) || 0,
          threshold:
            kiro.summarizationThreshold ?? kiro.contextUsage?.summarizationThreshold ?? next.context?.threshold,
          breakdown: kiro.breakdown ?? next.context?.breakdown ?? null,
        },
      };
    case 'turn_start':
      return {...next, busy: true};
    case 'turn_completion': {
      const items = next.items.map((one) => (one.closed ? one : {...one, closed: true}));
      const tools = items.filter((one) => one.type === 'tool' && !one.turnDone);
      return {
        ...next,
        busy: false,
        items: [
          ...items.map((one) => (one.type === 'tool' ? {...one, turnDone: true} : one)),
          {
            type: 'turn',
            id: `turn-${kiro.turnId ?? items.length}`,
            credits: turnCredits(kiro.promptTurnSummaries),
            ms: kiro.elapsedTime ?? null,
            status: kiro.status ?? null,
            toolChars: tools.reduce((sum, one) => sum + (one.chars || 0), 0),
          },
        ],
      };
    }
    case 'turn_end':
      return {...next, busy: false};
    default:
      // Kiro summarized the conversation to free the context
      if (
        /summar|compact/i.test(kiro.kind ?? '') &&
        /complet|done|finish/i.test(`${kiro.kind} ${kiro.status ?? ''} ${kiro.state ?? ''}`)
      ) {
        return {
          ...next,
          items: [...next.items, {type: 'notice', id: `notice-${next.items.length}`, notice: 'compacted'}],
        };
      }
      return next;
  }
}

/** The person's own message, as it goes into the chat before Kiro answers. */
export function addUserMessage(chat, message, chips = []) {
  const items = chat.items.map((one) => (one.closed ? one : {...one, closed: true}));
  return {
    ...chat,
    busy: true,
    items: [...items, {type: 'user', id: `user-${items.length}`, text: message, chips, closed: true}],
  };
}

/** The credits of every turn in the chat, added up; null when none was metered. */
export function chatCredits(chat) {
  const turns = chat.items.filter((one) => one.type === 'turn' && one.credits !== null);
  return turns.length ? turns.reduce((sum, one) => sum + one.credits, 0) : null;
}
