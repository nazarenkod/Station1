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
  // the model the conversation runs on, by Kiro's name of it
  model: null,
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
  // when the turn that runs began, for «working… N s»
  turnStartedAt: null,
  // why the last turn stopped before its answer (Kiro's stop reason), or null
  interrupted: null,
  needs: null,
  // whether this profile let its data go to the agent; null until known
  consent: null,
  draft: null,
  // notes the agent proposed or the person started, waiting for «Save»
  proposals: [],
  // goals the agent proposed, waiting for «Add»
  goalProposals: [],
  // notes the agent read in the turn that runs, then by the turn's line
  usedNow: [],
  turnNotes: {},
  // whether this conversation has the hands: off until the person asks for them
  hands: false,
  // the conversation is being loaded again with or without the hands
  handsSwitching: false,
  // what the agent did on the device in the turn that runs, or the last one
  handsSteps: [],
  // cards of the hands waiting for the person: more actions, a one-time code
  handsCards: [],
};
const listeners = new Set();
let started = false;
// what each conversation was opened for (a fix of one check of the doctor): the same ask goes on there
const topics = new Map();
// every conversation's chat by its session: Kiro replays one while it loads, before the window knows its id
const chats = new Map();

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
    const was = chats.get(sessionId) ?? emptyChat();
    const chat = applyUpdate(was, update);
    chats.set(sessionId, chat);
    if (sessionId !== state.sessionId) {
      return;
    }
    const before = was.items.length;
    const added = chat.items.slice(before).find((item) => item.type === 'turn');
    if (added) {
      publish({
        chat,
        turns: state.pendingTurn ? {...state.turns, [added.id]: state.pendingTurn} : state.turns,
        turnNotes: state.usedNow.length ? {...state.turnNotes, [added.id]: state.usedNow} : state.turnNotes,
        pendingTurn: null,
        usedNow: [],
      });
      refreshChanges();
    } else {
      publish({chat});
    }
  });
  backend.agent.onReset(({sessionId}) => {
    chats.set(sessionId, emptyChat());
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
  backend.agent.onMemoryUsed(({sessionId, notes}) => {
    if (sessionId === state.sessionId) {
      publish({
        usedNow: [...state.usedNow, ...notes.filter((note) => !state.usedNow.some((one) => one.id === note.id))],
      });
    }
  });
  backend.agent.onGoalProposal(({sessionId, goal}) => {
    if (!sessionId || sessionId === state.sessionId) {
      publish({open: true, goalProposals: [...state.goalProposals, {id: `goal-${++proposalId}`, goal}]});
    }
  });
  backend.agent.onMemoryProposal(({sessionId, ...proposal}) => {
    if (!sessionId || sessionId === state.sessionId) {
      addProposal(proposal);
    }
  });
  backend.agent.onHandsStep?.(({sessionId, ...step}) => {
    if (!sessionId || sessionId === state.sessionId) {
      publish({handsSteps: [...state.handsSteps, step].slice(-200)});
    }
  });
  backend.agent.onHandsMore?.(({id, sessionId}) => {
    if (!sessionId || sessionId === state.sessionId) {
      publish({open: true, handsCards: [...state.handsCards, {id, kind: 'more'}]});
    } else {
      backend.agent.cardAnswer(id, false);
    }
  });
  backend.agent.onOtp?.(({id, sessionId, account}) => {
    if (!sessionId || sessionId === state.sessionId) {
      publish({open: true, handsCards: [...state.handsCards, {id, kind: 'otp', account}]});
    }
  });
  backend.agent.onExit(() =>
    publish({status: state.status === 'busy' ? 'error' : 'idle', error: state.status === 'busy' ? 'stopped' : null}),
  );
  backend.agent.credits().then((credits) => publish({credits}));
}

const failed = (result) =>
  publish({status: 'error', error: result.error ?? 'other', errorDetail: result.detail ?? null});

// the conversation being opened: a second call while it opens waits for the same one
let opening = null;

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
  if (opening?.key === key) {
    return await opening.done;
  }
  const done = openAnew(profileId, taskKey, key).finally(() => {
    if (opening?.done === done) {
      opening = null;
    }
  });
  opening = {key, done};
  return await done;
}

async function openAnew(profileId, taskKey, key) {
  backend.agent.consented(profileId).then((consent) => publish({consent}));
  publish({
    status: 'starting',
    error: null,
    key,
    chat: emptyChat(),
    sessionId: null,
    changes: [],
    turns: {},
    interrupted: null,
  });
  // the first time this window opens a conversation it has no chat of it: Kiro replays it
  const replay = !chats.size;
  const result = await backend.agent.open({profileId, taskKey, replay});
  if (!result.ok) {
    failed(result);
    return;
  }
  publish({
    status: 'ready',
    sessionId: result.sessionId,
    hands: !!result.hands,
    model: result.model ?? null,
    chat: chats.get(result.sessionId) ?? emptyChat(),
  });
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
  const taskKey = currentTaskKey();
  publish({
    status: 'starting',
    key: `${profileId}/${taskKey ?? ''}`,
    chat: emptyChat(),
    sessionId: null,
    model: null,
    changes: [],
    turns: {},
    error: null,
    needs: null,
    budget: null,
    mcp: [],
    interrupted: null,
  });
  const result = await backend.agent.newConversation({profileId, taskKey});
  if (!result.ok) {
    failed(result);
    return;
  }
  publish({
    status: 'ready',
    sessionId: result.sessionId,
    hands: !!result.hands,
    model: result.model ?? null,
    chat: chats.get(result.sessionId) ?? emptyChat(),
  });
}

export async function resumeConversation(sessionId) {
  const profileId = activeProfileId();
  publish({status: 'starting', chat: emptyChat(), sessionId, changes: [], turns: {}, error: null, interrupted: null});
  const result = await backend.agent.resume({profileId, sessionId});
  if (!result.ok) {
    failed(result);
    return;
  }
  publish({
    status: 'ready',
    sessionId: result.sessionId,
    hands: !!result.hands,
    model: result.model ?? null,
    chat: chats.get(result.sessionId) ?? emptyChat(),
  });
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
  const sent = addUserMessage(state.chat, message, chips);
  chats.set(state.sessionId, sent);
  publish({
    chat: sent,
    status: 'busy',
    needs: null,
    budget: null,
    pendingTurn: turn,
    turnStartedAt: Date.now(),
    interrupted: null,
    handsSteps: [],
  });
  const result = await backend.agent.prompt({sessionId: state.sessionId, message, chips, deep, confirmCredits});
  if (result.ok) {
    // a turn cut short (the network, a limit) says so, and «Go on» picks it up
    const stop = result.stopReason ?? 'end_turn';
    publish({status: 'ready', turnStartedAt: null, interrupted: stop === 'end_turn' ? null : stop});
    refreshChanges();
    return;
  }
  // nothing was sent: the message goes back to the field
  const items = state.chat.items.slice(0, -1);
  chats.set(state.sessionId, {...state.chat, items, busy: false});
  if (result.error === 'consent') {
    publish({consent: false});
  }
  if (result.error === 'consent' || result.error === 'creditLimit') {
    publish({
      chat: {...state.chat, items, busy: false},
      status: 'ready',
      needs: {kind: result.error, message, chips, deep, spent: result.detail},
    });
    return;
  }
  publish({chat: {...state.chat, busy: false}, turnStartedAt: null});
  failed(result);
}

/**
 * Goes on after a turn that broke off or an error: the conversation is
 * loaded again when Kiro lost it, and the operator is told to carry on from
 * where it stopped.
 * @param {string} message the words that ask to go on, in the person's language
 */
export async function continueConversation(message) {
  const sessionId = state.sessionId;
  if (!sessionId) {
    await openConversation();
    return;
  }
  publish({status: 'starting', error: null, errorDetail: null, interrupted: null});
  const result = await backend.agent.resume({profileId: activeProfileId(), sessionId});
  if (!result.ok) {
    failed(result);
    return;
  }
  publish({
    status: 'ready',
    model: result.model ?? state.model,
    chat: chats.get(result.sessionId) ?? state.chat,
  });
  await sendMessage(message, []);
}

export async function giveConsent() {
  const pending = state.needs;
  await backend.agent.consent(activeProfileId(), true);
  publish({needs: null, consent: true});
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
    publish({
      sessionId: null,
      key: null,
      chat: emptyChat(),
      changes: [],
      turns: {},
      permissions: [],
      handsSteps: [],
      handsCards: [],
      hands: false,
    });
    if (state.open) {
      openConversation();
    }
  }
}

// resolves when no turn runs: a message sent mid-turn would land in the middle of another answer
const whenIdle = () =>
  state.status !== 'busy'
    ? Promise.resolve()
    : new Promise((resolve) => {
        const check = () => {
          if (state.status !== 'busy') {
            listeners.delete(check);
            resolve();
          }
        };
        listeners.add(check);
      });

/**
 * Opens the chat on the task's conversation and sends a message there, for
 * the buttons of the desk: right away, or as soon as the turn that runs ends.
 */
export async function askOnTask(message, {deep = false, chips = [], topic = null, hands = false} = {}) {
  publish({open: true});
  await openConversation();
  await whenIdle();
  // testing the task goes on in its own conversation, with the hands on
  if (hands && state.sessionId && !state.hands) {
    const problem = await setHands(true);
    if (problem) {
      return problem;
    }
  }
  // an ask with a topic of its own (fixing one check) gets a conversation of its own: the context stays small and cheap
  if (topic && topics.get(state.sessionId) !== topic) {
    await newConversation();
    if (state.sessionId) {
      topics.set(state.sessionId, topic);
    }
  }
  if (state.sessionId) {
    await sendMessage(message, chips, {deep});
  }
  return null;
}

let proposalId = 0;

/** A note card in the chat: from the agent, or started by the person, saved only with «Save». */
export function addProposal({note, replaces = null, similar = null, hint = null}) {
  publish({
    open: true,
    proposals: [...state.proposals, {id: `prop-${++proposalId}`, note, replaces, similar, hint, error: null}],
  });
}

export const dismissProposal = (id) => publish({proposals: state.proposals.filter((one) => one.id !== id)});

/** Saves a note card; a similar note asks to replace it or keep both. */
export async function saveProposal(id, note, options = {}) {
  const result = await backend.memory.save(note, options);
  if (result.ok) {
    dismissProposal(id);
    return result;
  }
  publish({
    proposals: state.proposals.map((one) =>
      one.id === id ? {...one, note, error: result.reason, similar: result.similar ?? one.similar} : one,
    ),
  });
  return result;
}

export const dismissGoalProposal = (id) => publish({goalProposals: state.goalProposals.filter((one) => one.id !== id)});

/** «Stop» on the device: the agent does nothing more there and its turn ends. */
export async function stopHands() {
  if (state.sessionId) {
    await backend.agent.handsStop(state.sessionId);
  }
  for (const card of state.handsCards) {
    await backend.agent.cardAnswer(card.id, false);
  }
  publish({handsCards: []});
}

/** The person's answer to a card of the hands. */
export async function answerHandsCard(id, answer) {
  await backend.agent.cardAnswer(id, answer);
  publish({handsCards: state.handsCards.filter((card) => card.id !== id)});
}

/**
 * The hands on or off in this conversation: the same conversation goes on
 * with them or without them. Returns what went wrong, or null.
 */
export async function setHands(on) {
  if (!state.sessionId || state.handsSwitching) {
    return null;
  }
  publish({handsSwitching: true});
  try {
    const result = await backend.agent.setHands(state.sessionId, on);
    publish(result.ok ? {hands: result.hands} : {});
    return result.ok ? null : result.error;
  } finally {
    publish({handsSwitching: false});
  }
}
