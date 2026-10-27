import {useSyncExternalStore} from 'react';

import {addUserMessage, applyUpdate, emptyChat} from '../../../shared/agent/acp-events.js';
import {backend} from '../../polyfills.js';
import {profilesState} from '../settings/profiles-store.js';
import {currentTaskKey} from '../task/task-store.js';

// The agent's chat as the window sees it: whether the panel is open, the
// conversation of the profile (and task) that is on, its messages and tool
// calls, the permission cards waiting for the person, the credits, and the
// changes the agent made. Kiro's updates come from the main process.

let state = {
  open: false,
  status: 'idle',
  error: null,
  sessionId: null,
  key: null,
  chat: emptyChat(),
  permissions: [],
  credits: null,
  budget: null,
  mcp: [],
  changes: [],
  // the journal's turn number of each turn line of the chat, to roll a turn back
  turns: {},
  pendingTurn: null,
  needs: null,
  draft: null,
};
const listeners = new Set();
let started = false;

function publish(patch) {
  state = {...state, ...patch};
  for (const listener of listeners) {
    listener();
  }
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useAgent = () => useSyncExternalStore(subscribe, () => state);
export const agentState = () => state;

const activeProfileId = () => profilesState().activeId;

async function refreshChanges() {
  if (state.sessionId) {
    publish({changes: await backend.agent.changes(state.sessionId)});
  }
}

/** Listens to the main process. Called once by the shell. */
export function startAgent() {
  if (started || !backend?.agent) {
    return;
  }
  started = true;
  backend.agent.onUpdate(({sessionId, update}) => {
    if (sessionId !== state.sessionId) {
      return;
    }
    const before = state.chat.items.length;
    const chat = applyUpdate(state.chat, update);
    const added = chat.items.slice(before).find((item) => item.type === 'turn');
    if (added && state.pendingTurn) {
      publish({chat, turns: {...state.turns, [added.id]: state.pendingTurn}, pendingTurn: null});
      refreshChanges();
    } else {
      publish({chat});
    }
  });
  backend.agent.onReset(({sessionId}) => {
    if (sessionId === state.sessionId) {
      publish({chat: emptyChat(), turns: {}});
    }
  });
  backend.agent.onPermission((request) => publish({permissions: [...state.permissions, request], open: true}));
  backend.agent.onCredits((summary) => publish({credits: {...state.credits, summary}}));
  backend.agent.onBudget((event) => {
    if (event.sessionId === state.sessionId) {
      publish({budget: event});
    }
  });
  backend.agent.onMcpStatus(({sessionId, servers}) => {
    if (sessionId === state.sessionId) {
      publish({mcp: servers});
    }
  });
  backend.agent.onExit(() =>
    publish({status: state.status === 'busy' ? 'error' : 'idle', error: state.status === 'busy' ? 'stopped' : null}),
  );
  backend.agent.credits().then((credits) => publish({credits}));
}

const failed = (result) =>
  publish({status: 'error', error: result.error ?? 'other', errorDetail: result.detail ?? null});

/** Opens the conversation of the profile that is on (and of its task). */
export async function openConversation({taskKey = currentTaskKey()} = {}) {
  const profileId = activeProfileId();
  if (!profileId || !backend?.agent) {
    return;
  }
  const key = `${profileId}/${taskKey ?? ''}`;
  if (state.key === key && state.sessionId) {
    return;
  }
  publish({status: 'starting', error: null, key, chat: emptyChat(), sessionId: null, changes: [], turns: {}});
  const result = await backend.agent.open({profileId, taskKey});
  if (!result.ok) {
    failed(result);
    return;
  }
  publish({status: 'ready', sessionId: result.sessionId});
  refreshChanges();
}

export function toggleAgent(open = !state.open) {
  publish({open});
  if (open && !state.sessionId && state.status !== 'starting') {
    openConversation();
  }
}

/** Opens the chat with a chip added, for «Ask the agent» next to a request or a line. */
export function askAbout(pick) {
  publish({open: true, draft: {pick, at: Date.now()}});
  if (!state.sessionId && state.status !== 'starting') {
    openConversation();
  }
}

export async function newConversation() {
  const profileId = activeProfileId();
  publish({status: 'starting', chat: emptyChat(), sessionId: null, changes: [], turns: {}, error: null});
  const result = await backend.agent.newConversation({profileId, taskKey: currentTaskKey()});
  if (!result.ok) {
    failed(result);
    return;
  }
  publish({status: 'ready', sessionId: result.sessionId});
}

export async function resumeConversation(sessionId) {
  const profileId = activeProfileId();
  publish({status: 'starting', chat: emptyChat(), sessionId, changes: [], turns: {}, error: null});
  const result = await backend.agent.resume({profileId, sessionId});
  if (!result.ok) {
    failed(result);
    return;
  }
  publish({status: 'ready', sessionId: result.sessionId});
  refreshChanges();
}

export const pastConversations = () => backend.agent.past(activeProfileId());

/**
 * Sends a message. The consent of the profile and the credit threshold may
 * stop it: then `needs` says what the person has to answer first.
 */
export async function sendMessage(message, chips, {deep = false, confirmCredits = false} = {}) {
  if (!state.sessionId || !message.trim()) {
    return;
  }
  // the journal numbers the turns of this run; this message starts the next one
  const turn = ((await backend.agent.turn(state.sessionId)) ?? 0) + 1;
  publish({
    chat: addUserMessage(state.chat, message, chips),
    status: 'busy',
    needs: null,
    budget: null,
    pendingTurn: turn,
  });
  const result = await backend.agent.prompt({sessionId: state.sessionId, message, chips, deep, confirmCredits});
  if (result.ok) {
    publish({status: 'ready'});
    refreshChanges();
    return;
  }
  // nothing was sent: the message goes back to the field
  const items = state.chat.items.slice(0, -1);
  if (result.error === 'consent' || result.error === 'creditLimit') {
    publish({
      chat: {...state.chat, items, busy: false},
      status: 'ready',
      needs: {kind: result.error, message, chips, deep, spent: result.detail},
    });
    return;
  }
  publish({chat: {...state.chat, busy: false}});
  failed(result);
}

export async function giveConsent() {
  const pending = state.needs;
  await backend.agent.consent(activeProfileId(), true);
  publish({needs: null});
  if (pending) {
    await sendMessage(pending.message, pending.chips, {deep: pending.deep});
  }
}

export async function confirmCredits() {
  const pending = state.needs;
  publish({needs: null});
  if (pending) {
    await sendMessage(pending.message, pending.chips, {deep: pending.deep, confirmCredits: true});
  }
}

export const dismissNeeds = () => publish({needs: null});

export function cancelTurn() {
  if (state.sessionId) {
    backend.agent.cancel(state.sessionId);
  }
}

export async function answerPermission(id, optionId) {
  publish({permissions: state.permissions.filter((one) => one.id !== id)});
  await backend.agent.answerPermission(id, optionId);
  refreshChanges();
}

/** The person lets the agent read more: the budget grows and the agent is told to go on. */
export async function readMore() {
  await backend.agent.extend(state.sessionId);
  publish({budget: null});
}

export async function undoChange(id, force = false) {
  const result = await backend.agent.undo(id, force);
  await refreshChanges();
  return result;
}

export async function undoTurn(turn, force = false) {
  const result = await backend.agent.undoTurn(state.sessionId, turn, force);
  await refreshChanges();
  return result;
}

export async function refreshCredits() {
  publish({credits: await backend.agent.credits()});
}

/** Another profile or task: its own conversation, opened when the panel is. */
export function followProfile() {
  const key = `${activeProfileId()}/${currentTaskKey() ?? ''}`;
  if (state.sessionId && state.key !== key) {
    publish({sessionId: null, key: null, chat: emptyChat(), changes: [], turns: {}, permissions: []});
    if (state.open) {
      openConversation();
    }
  }
}

/** Opens the chat on the task's conversation and sends a message there, for the task card's buttons. */
export async function askOnTask(message, {deep = false, chips = []} = {}) {
  publish({open: true});
  await openConversation();
  if (state.sessionId) {
    await sendMessage(message, chips, {deep});
  }
}
