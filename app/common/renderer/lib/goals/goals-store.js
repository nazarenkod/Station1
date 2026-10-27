import {useSyncExternalStore} from 'react';

import {cleanGoal, createGoalRun, goalReport, runCounts} from '../../../shared/agent/goals.js';
import {activeDevice} from '../../actions/Workstation.js';
import {screenHistory} from '../../components/A11yTool/screen-history.js';
import {logsState} from '../../components/Logs/logs-store.js';
import {proxyState} from '../../components/Proxy/proxy-store.js';
import {backend} from '../../polyfills.js';

// The goals of the task that is on, counted in the window on what the proxy,
// the log and the Inspector see. A new session (or «New test») starts a new
// run; each run is kept with the task. Nothing here asks the agent.

const TICK_MS = 1000;
const SAVE_MS = 2000;

let state = {key: null, profileId: null, goals: [], run: null, version: 0};
const listeners = new Set();
let started = false;
let runner = null;
let reduxStore = null;
let seen = {exchanges: new Set(), logSeq: -1, screen: null, sessionId: undefined, sessionStart: 0};
let saveTimer = null;
let ticked = new Set();

const publish = (patch) => {
  state = {...state, ...patch, version: state.version + 1};
  for (const listener of listeners) {
    listener();
  }
};
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useGoals = () => useSyncExternalStore(subscribe, () => state);
export const goalsState = () => state;

const runMeta = () => {
  const workstation = reduxStore?.getState().workstation;
  const device = workstation ? activeDevice(workstation) : null;
  return {device: device?.name ?? null, app: workstation?.app?.id ?? null, build: workstation?.app?.version ?? null};
};

const saveSoon = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (state.key && state.run) {
      backend.task.saveRun(state.profileId, state.key, {id: state.run.id, ...runner.snapshot()});
    }
  }, SAVE_MS);
};

// a goal that checks an item of the impact checklist ticks it when it passes
function tickItems() {
  for (const goal of state.goals) {
    const passed = runner.states()[goal.id]?.state === 'passed';
    if (goal.itemId && passed && !ticked.has(goal.id)) {
      ticked.add(goal.id);
      backend.task.check(state.profileId, state.key, goal.itemId, true);
    }
  }
}

/** Feeds the run what happened since the last look; true when a goal changed. */
function feed() {
  let changed = false;
  const proxy = proxyState();
  for (const id of proxy.order) {
    const exchange = proxy.byId.get(id);
    if (!exchange || seen.exchanges.has(id) || (exchange.startedAt ?? 0) < seen.sessionStart) {
      continue;
    }
    // a request is counted once its answer is there, or it is broken
    if (exchange.status === null && !exchange.flags?.length) {
      continue;
    }
    seen.exchanges.add(id);
    changed = runner.onExchange(exchange) || changed;
  }
  // log lines come with growing numbers; the oldest may already be gone from the front
  const logs = logsState();
  for (const entry of logs.entries) {
    if ((entry.seq ?? -1) > seen.logSeq) {
      changed = runner.onLog(entry) || changed;
      seen.logSeq = entry.seq ?? seen.logSeq;
    }
  }
  const flow = screenHistory();
  const screen = flow.screens?.find((one) => one.key === flow.currentKey);
  const spot = screen ? `${screen.key}/${flow.currentStateId}` : null;
  if (spot && spot !== seen.screen) {
    seen.screen = spot;
    const stateOf = screen.states?.find((one) => one.id === flow.currentStateId);
    changed = runner.onScreen({key: screen.key, title: screen.title, state: stateOf?.title ?? null}) || changed;
  }
  return changed;
}

/** A run over the goals: a new session starts it from scratch, a change of the goals counts again. */
function restart({newSession}) {
  const manual = runner && !newSession ? runner.states() : {};
  if (newSession && runner && state.run) {
    // the run of the session that ended stays with the task
    backend.task.saveRun(state.profileId, state.key, {id: state.run.id, ...runner.snapshot()});
  }
  runner = createGoalRun(state.goals, {...runMeta(), startedAt: new Date().toISOString()});
  for (const [id, one] of Object.entries(manual)) {
    if (one.state === 'passed' && one.evidence?.kind === 'manual') {
      runner.setManual(id, true);
    }
  }
  const sessionStart = seen.sessionStart;
  seen = {exchanges: new Set(), logSeq: -1, screen: null, sessionId: screenHistory().sessionId, sessionStart};
  ticked = new Set();
  feed();
  publish({
    run: {id: newSession || !state.run ? `run-${Date.now().toString(36)}` : state.run.id, ...runner.snapshot()},
  });
  saveSoon();
}

function tick() {
  if (!state.goals.length || !runner) {
    return;
  }
  if (!runner.device && reduxStore) {
    runner.describe(runMeta());
  }
  const sessionId = screenHistory().sessionId;
  if (sessionId !== seen.sessionId) {
    seen.sessionStart = Date.now();
    restart({newSession: true});
    return;
  }
  if (feed()) {
    tickItems();
    publish({run: {...state.run, ...runner.snapshot()}});
    saveSoon();
  }
}

/** Takes the goals of the task that is on, when the task or its goals change. */
export function followGoals(task) {
  const goals = (task.data?.goals ?? []).map(cleanGoal);
  const sameTask = task.current === state.key && task.profileId === state.profileId;
  const sameGoals = sameTask && JSON.stringify(goals) === JSON.stringify(state.goals);
  if (sameGoals) {
    return;
  }
  publish({key: task.current, profileId: task.profileId, goals});
  if (!goals.length) {
    runner = null;
    publish({run: null});
    return;
  }
  if (!sameTask) {
    seen.sessionStart = 0;
  }
  restart({newSession: !sameTask});
}

/** «New test» on the same session: the goals start a new run. */
export function newGoalRun() {
  if (runner && state.goals.length) {
    seen.sessionStart = Date.now();
    restart({newSession: true});
  }
}

export function startGoals(store) {
  if (started || !backend?.task) {
    return;
  }
  started = true;
  reduxStore = store;
  setInterval(tick, TICK_MS);
}

const saveGoals = (goals) => backend.task.setGoals(state.profileId, state.key, goals);

export const addGoal = (goal) => saveGoals([...state.goals, cleanGoal(goal)]);
export const updateGoal = (id, patch) =>
  saveGoals(state.goals.map((goal) => (goal.id === id ? cleanGoal({...goal, ...patch, id}) : goal)));
export const removeGoal = (id) => saveGoals(state.goals.filter((goal) => goal.id !== id));

export function setManual(id, done) {
  runner?.setManual(id, done);
  if (runner) {
    tickItems();
    publish({run: {...state.run, ...runner.snapshot()}});
    saveSoon();
  }
}

export const counts = () => runCounts(state.goals, state.run?.states);

export const reportOf = (task, run, labels) => goalReport({task, run, goals: state.goals, labels});

/** The goals of a task's earlier runs, the latest first, the one that runs left out. */
export const pastRuns = (data) => (data?.goalRuns ?? []).filter((run) => run.id !== state.run?.id);
