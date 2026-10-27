import {randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {turnCredits} from '../../shared/agent/acp-events.js';
import {promptBlocks} from '../../shared/agent/context.js';
import {
  addConversation,
  currentSession,
  findConversation,
  pastConversations,
  resumeConversation,
  touchConversation,
} from '../../shared/agent/conversations.js';
import {needsConfirm, todayOf} from '../../shared/agent/credits.js';
import {composeSteering} from '../../shared/agent/instructions.js';
import {cleanServers, secretNames, stationServer, toAcpServers} from '../../shared/agent/mcp-servers.js';
import {decidePermission} from '../../shared/agent/permissions.js';
import {
  AGENT_CONFIG,
  AGENT_CONSENT,
  AGENT_PROJECT,
  AGENT_SESSIONS,
  DEFAULT_SETTINGS,
} from '../../shared/setting-defs.js';
import {kiroProblem} from './kiro.js';

// The station's agent as one service: which conversation a profile and a
// task have, what goes with each message, which folders and servers a
// conversation opens, what the station answers when Kiro asks permission,
// and the credits of each turn. The window only shows and asks.

/**
 * @param {object} deps
 * @param {import('./kiro.js').KiroAgent} deps.kiro
 * @param {ReturnType<import('./station-mcp.js').createStationMcp>} deps.mcp
 * @param {ReturnType<import('./credits-store.js').createCreditsStore>} deps.credits
 * @param {(key: string) => Promise<any>} deps.get
 * @param {(key: string, value: any) => Promise<void>} deps.set
 * @param {(profileId: string) => Promise<{cwd: string | null, additionalDirectories: string[]}>} deps.workspace the code of a profile
 * @param {(serverId: string) => Promise<Record<string, string>>} deps.secrets the hidden fields of an MCP server
 * @param {string} deps.home the station's own folder for the agent
 * @param {(channel: string, payload: object) => void} deps.send to the window
 * @param {(request: object) => Promise<{optionId: string} | null>} deps.ask the person, for a permission
 * @param {(sessionId: string) => string[]} [deps.pinnedNotes] notes of the memory every conversation starts with
 * @param {(turn: object) => Promise<void>} [deps.onTurn] a turn ended, with its credits
 * @param {(chips: object[]) => Promise<object[]>} [deps.notesFor] the notes of the memory about what the chips name
 */
export function createAgentService(deps) {
  const setting = async (key) => ({...DEFAULT_SETTINGS[key], ...((await deps.get(key)) ?? {})});
  // sessions this run of Kiro already knows: started or loaded since it started
  const open = new Map();
  // what each session's tool calls asked for, so a permission card can say what will change
  const toolInputs = new Map();
  const turns = new Map();

  deps.kiro.on('exit', () => open.clear());

  deps.kiro.on('update', async (sessionId, update) => {
    deps.send('agent:update', {sessionId, update});
    if (update?.sessionUpdate === 'tool_call' && update.rawInput) {
      toolInputs.set(update.toolCallId, update.rawInput.arguments ?? update.rawInput);
    }
    const kiro = update?._meta?.kiro;
    if (update?.sessionUpdate === 'session_info_update' && kiro?.kind === 'turn_completion' && !kiro.replay) {
      const known = open.get(sessionId) ?? findConversation(await deps.get(AGENT_SESSIONS), sessionId);
      const credits = turnCredits(kiro.promptTurnSummaries);
      await deps.credits.add({
        profileId: known?.profileId,
        taskKey: known?.taskKey ?? null,
        sessionId,
        credits,
        ms: kiro.elapsedTime ?? null,
      });
      await deps.onTurn?.({
        profileId: known?.profileId,
        taskKey: known?.taskKey ?? null,
        conversation: known?.conversation ?? null,
        turn: turns.get(sessionId) ?? 0,
        credits,
      });
      deps.send('agent:credits', await deps.credits.summary());
    }
    if (update?.sessionUpdate === 'session_info_update' && update.title) {
      const known = open.get(sessionId);
      if (known) {
        await deps.set(
          AGENT_SESSIONS,
          touchConversation(await deps.get(AGENT_SESSIONS), known.profileId, sessionId, {title: update.title}),
        );
      }
    }
  });

  deps.kiro.on('mcpStatus', (sessionId, servers) => deps.send('agent:mcpStatus', {sessionId, servers}));

  /** The steering document in the station's folder, written when it changed. */
  const writeSteering = async () => {
    const config = await setting(AGENT_CONFIG);
    const project = await setting(AGENT_PROJECT);
    const text = composeSteering({
      station: config.stationInstructions,
      project: project.instructions,
      personal: config.personalInstructions,
      pinned: deps.pinnedNotes ? await deps.pinnedNotes() : [],
    });
    const file = path.join(deps.home, '.kiro', 'steering', 'station.md');
    const before = await readFile(file, 'utf8').catch(() => null);
    if (before !== text) {
      await mkdir(path.dirname(file), {recursive: true});
      await writeFile(file, text);
    }
  };

  /** What a conversation opens: its folders and its servers, the station's own first. */
  const sessionInputs = async (profileId, conversation, off = new Set()) => {
    await writeSteering();
    const {port, token} = await deps.mcp.start();
    const config = await setting(AGENT_CONFIG);
    const project = await setting(AGENT_PROJECT);
    const servers = cleanServers([...(config.mcpServers ?? []), ...(project.mcpServers ?? [])]);
    const secrets = {};
    for (const server of servers) {
      if (secretNames(server).length) {
        secrets[server.id] = await deps.secrets(server.id);
      }
    }
    const code = await deps.workspace(profileId);
    // the station's folder carries the instructions; with no code it is where the agent works
    const additionalDirectories = code.cwd ? [...code.additionalDirectories, deps.home] : code.additionalDirectories;
    return {
      cwd: code.cwd ?? deps.home,
      additionalDirectories,
      mcpServers: [stationServer({port, token, conversation}), ...toAcpServers(servers, secrets, off)],
    };
  };

  const startNew = async (profileId, taskKey) => {
    const conversation = randomUUID();
    const inputs = await sessionInputs(profileId, conversation);
    const result = await deps.kiro.newSession(inputs);
    const sessions = addConversation(await deps.get(AGENT_SESSIONS), profileId, {
      sessionId: result.sessionId,
      conversation,
      taskKey,
    });
    await deps.set(AGENT_SESSIONS, sessions);
    open.set(result.sessionId, {profileId, taskKey, conversation});
    return {sessionId: result.sessionId, conversation, fresh: true};
  };

  const load = async (profileId, sessionId) => {
    const entry = findConversation(await deps.get(AGENT_SESSIONS), sessionId);
    const conversation = entry?.conversation ?? sessionId;
    const taskKey = entry?.key && entry.key !== '_general' ? entry.key : null;
    // Kiro sends the conversation again as updates; the window starts it clean
    deps.send('agent:reset', {sessionId});
    await deps.kiro.loadSession({sessionId, ...(await sessionInputs(profileId, conversation))});
    open.set(sessionId, {profileId, taskKey, conversation});
    return {sessionId, conversation, fresh: false};
  };

  const service = {
    /**
     * The conversation of a profile and a task: the current one, loaded when
     * this run of Kiro has not seen it (or the window asks to replay it), or a new one.
     */
    async open({profileId, taskKey = null, replay = false}) {
      try {
        const sessionId = currentSession(await deps.get(AGENT_SESSIONS), profileId, taskKey);
        // a window opened anew has no chat yet: the conversation is loaded again to replay it
        if (sessionId && open.has(sessionId) && !replay) {
          return {ok: true, sessionId, conversation: open.get(sessionId).conversation, fresh: false};
        }
        if (sessionId) {
          try {
            return {ok: true, ...(await load(profileId, sessionId))};
          } catch {
            // Kiro lost it: a new conversation in its place
          }
        }
        return {ok: true, ...(await startNew(profileId, taskKey))};
      } catch (error) {
        return {ok: false, error: kiroProblem(error), detail: error.message};
      }
    },

    async newConversation({profileId, taskKey = null}) {
      try {
        return {ok: true, ...(await startNew(profileId, taskKey))};
      } catch (error) {
        return {ok: false, error: kiroProblem(error), detail: error.message};
      }
    },

    async resume({profileId, sessionId}) {
      await deps.set(AGENT_SESSIONS, resumeConversation(await deps.get(AGENT_SESSIONS), profileId, sessionId));
      try {
        return {
          ok: true,
          ...(open.has(sessionId)
            ? {sessionId, conversation: open.get(sessionId).conversation}
            : await load(profileId, sessionId)),
        };
      } catch (error) {
        return {ok: false, error: kiroProblem(error), detail: error.message};
      }
    },

    async past(profileId) {
      return pastConversations(await deps.get(AGENT_SESSIONS), profileId);
    },

    /**
     * Sends a message. Before it: the consent of the profile, and a yes once
     * a day when the credit threshold is passed.
     * @returns {Promise<{ok: true, stopReason: string} | {ok: false, error: string, detail?: string}>}
     */
    async prompt({sessionId, message, chips = [], deep = false, confirmCredits = false}) {
      const known = open.get(sessionId);
      if (!known) {
        return {ok: false, error: 'stopped'};
      }
      const consent = await setting(AGENT_CONSENT);
      if (!consent.profiles?.[known.profileId]) {
        return {ok: false, error: 'consent'};
      }
      const config = await setting(AGENT_CONFIG);
      const spentToday = (await deps.credits.summary()).today;
      if (needsConfirm({spentToday, limit: config.dailyCreditLimit, confirmedDay: consent.confirmedDay})) {
        if (!confirmCredits) {
          return {ok: false, error: 'creditLimit', detail: String(spentToday)};
        }
        await deps.set(AGENT_CONSENT, {...consent, confirmedDay: todayOf(new Date())});
      }
      turns.set(sessionId, (turns.get(sessionId) ?? 0) + 1);
      deps.mcp.startTurn(known.conversation, {deep, limits: {read: config.readBudget, deep: config.deepBudget}});
      await deps.set(AGENT_SESSIONS, touchConversation(await deps.get(AGENT_SESSIONS), known.profileId, sessionId));
      try {
        // notes about the screen or request go along by their ids only; the agent reads them if it needs
        const notes = deps.notesFor ? await deps.notesFor(chips).catch(() => []) : [];
        const withNotes = notes.length
          ? [...chips, {kind: 'notes', id: notes.map((note) => note.id).join(','), label: `${notes.length} notes`}]
          : chips;
        const result = await deps.kiro.prompt(sessionId, promptBlocks(message, withNotes));
        return {ok: true, stopReason: result?.stopReason ?? 'end_turn', turn: turns.get(sessionId)};
      } catch (error) {
        if (!deps.kiro.running) {
          open.delete(sessionId);
        }
        return {ok: false, error: kiroProblem(error), detail: error.message};
      }
    },

    cancel(sessionId) {
      deps.kiro.cancel(sessionId);
    },

    /** The turn a conversation is in, for the journal of changes. */
    turnOf(conversation) {
      for (const [sessionId, known] of open) {
        if (known.conversation === conversation) {
          return turns.get(sessionId) ?? 0;
        }
      }
      return 0;
    },

    sessionOf(conversation) {
      for (const [sessionId, known] of open) {
        if (known.conversation === conversation) {
          return sessionId;
        }
      }
      return null;
    },

    conversationOf: (sessionId) => open.get(sessionId)?.conversation ?? null,

    async consent(profileId, given = true) {
      const consent = await setting(AGENT_CONSENT);
      await deps.set(AGENT_CONSENT, {...consent, profiles: {...consent.profiles, [profileId]: given}});
    },

    /**
     * Kiro asks permission: the station answers what it can by itself, and
     * asks the person the rest with what the call wants to do.
     */
    async permission(request) {
      const decision = decidePermission(request, {readTools: deps.mcp.readTools});
      if (decision.action !== 'ask') {
        return {optionId: decision.optionId};
      }
      return await deps.ask({...request, input: toolInputs.get(request.toolCall?.toolCallId) ?? null});
    },
  };
  return service;
}
