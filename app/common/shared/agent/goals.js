import {endpointOf} from '../findings/traffic-rules.js';
import {urlMatcher} from '../proxy/mock-rules.js';

// Goals of a session: checks the station counts by itself on live traffic,
// log lines and screens, without AI and without credits. The agent proposes
// them, the person accepts, and the station marks each one as the session
// goes: passed with its evidence, failed with what broke it, or holding for
// the ones that must not happen.

export const GOAL_TYPES = ['request', 'field', 'status', 'log', 'screen', 'noFlags', 'manual'];
export const GOAL_SOURCES = ['task', 'mr', 'code', 'impact', 'manual', 'agent'];
export const FIELD_PLACES = ['request.body', 'request.query', 'request.header', 'response.body', 'response.header'];
export const FIELD_OPS = ['exists', 'equals', 'matches', 'absent'];

const RED_FLAGS = new Set(['error', 'aborted', 'tls', 'contract']);

const newGoalId = () => `g-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const text = (value, limit = 300) =>
  String(value ?? '')
    .trim()
    .slice(0, limit);

/** A goal as it is kept: its type and what the type needs, a title, where it came from. */
export function cleanGoal(goal) {
  const type = GOAL_TYPES.includes(goal?.type) ? goal.type : 'manual';
  const params = goal?.params ?? {};
  const clean = {
    method: params.method ? text(params.method, 10).toUpperCase() : '',
    path: text(params.path, 300),
    where: FIELD_PLACES.includes(params.where) ? params.where : 'request.body',
    field: text(params.field, 200),
    op: FIELD_OPS.includes(params.op) ? params.op : 'exists',
    value: params.value === undefined ? '' : text(params.value, 300),
    status: text(params.status, 10),
    pattern: text(params.pattern, 300),
    level: ['V', 'D', 'I', 'W', 'E', 'F'].includes(params.level) ? params.level : '',
    tag: text(params.tag, 80),
    mode: params.mode === 'notSeen' ? 'notSeen' : 'seen',
    screen: text(params.screen, 120),
    state: text(params.state, 120),
  };
  const needs = {
    request: ['method', 'path'],
    field: ['method', 'path', 'where', 'field', 'op', 'value'],
    status: ['method', 'path', 'status'],
    log: ['pattern', 'level', 'tag', 'mode'],
    screen: ['screen', 'state'],
    noFlags: ['method', 'path'],
    manual: [],
  }[type];
  return {
    id: text(goal?.id, 60) || newGoalId(),
    type,
    title: text(goal?.title, 160),
    source: GOAL_SOURCES.includes(goal?.source) ? goal.source : 'manual',
    expectOn: text(goal?.expectOn, 120),
    why: text(goal?.why, 600),
    itemId: goal?.itemId ? text(goal.itemId, 80) : undefined,
    params: Object.fromEntries(needs.map((key) => [key, clean[key]])),
  };
}

/** What is missing for a goal to be counted, or null when it can be. */
export function goalProblem(goal) {
  const {type, params, title} = goal;
  if (!title) {
    return 'title';
  }
  if (['request', 'field', 'status', 'noFlags'].includes(type) && !params.path) {
    return 'path';
  }
  if (type === 'field' && !params.field) {
    return 'field';
  }
  if (type === 'field' && ['equals', 'matches'].includes(params.op) && params.value === '') {
    return 'value';
  }
  if (type === 'status' && !params.status) {
    return 'status';
  }
  if (type === 'log') {
    if (!params.pattern) {
      return 'pattern';
    }
    try {
      new RegExp(params.pattern, 'i');
    } catch {
      return 'pattern';
    }
  }
  if (type === 'field' && params.op === 'matches') {
    try {
      new RegExp(params.value, 'i');
    } catch {
      return 'value';
    }
  }
  if (type === 'screen' && !params.screen) {
    return 'screen';
  }
  return null;
}

const parseJson = (body) => {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
};

function valueAt(source, path) {
  let current = source;
  for (const part of String(path)
    .split(/\.|\[(\d+)\]/)
    .filter(Boolean)) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[/^\d+$/.test(part) ? Number(part) : part];
  }
  return current;
}

const headerValue = (headers, name) => {
  const wanted = String(name).toLowerCase();
  const found = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === wanted);
  return found ? found[1] : undefined;
};

function fieldValue(exchange, where, field) {
  switch (where) {
    case 'request.query':
      try {
        return new URL(exchange.url).searchParams.get(field) ?? undefined;
      } catch {
        return undefined;
      }
    case 'request.header':
      return headerValue(exchange.requestHeaders, field);
    case 'response.header':
      return headerValue(exchange.responseHeaders, field);
    case 'response.body':
      return valueAt(parseJson(exchange.responseBody), field);
    default:
      return valueAt(parseJson(exchange.requestBody), field);
  }
}

const statusFits = (status, wanted) =>
  /^\dxx$/i.test(wanted) ? Math.floor((status ?? 0) / 100) === Number(wanted[0]) : String(status) === String(wanted);

const shown = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

/**
 * A goal made ready to check many events fast: its matchers compiled once.
 * `check` gives the verdict on one event, or null when the event is not
 * about this goal.
 */
export function compileGoal(goal) {
  const {type, params} = goal;
  const urlFits = params.path ? urlMatcher(params.path) : () => true;
  const requestFits = (exchange) => (!params.method || exchange.method === params.method) && urlFits(exchange.url);
  const pattern = type === 'log' ? new RegExp(params.pattern, 'i') : null;
  const valuePattern = type === 'field' && params.op === 'matches' ? new RegExp(params.value, 'i') : null;
  const levels = ['V', 'D', 'I', 'W', 'E', 'F'];

  return {
    goal,
    onExchange(exchange) {
      if (exchange.status === null || exchange.status === undefined || !requestFits(exchange)) {
        // a request still waiting for its answer is checked when the answer comes
        if (type === 'noFlags' && requestFits(exchange) && exchange.flags?.some((flag) => RED_FLAGS.has(flag))) {
          return {verdict: 'failed', note: exchange.flags.join(', ')};
        }
        return null;
      }
      switch (type) {
        case 'request':
          return {verdict: 'passed'};
        case 'status':
          return statusFits(exchange.status, params.status)
            ? {verdict: 'passed'}
            : {verdict: 'failed', note: `status ${exchange.status}`};
        case 'field': {
          const value = fieldValue(exchange, params.where, params.field);
          const present = value !== undefined && value !== null && value !== '';
          const ok =
            params.op === 'exists'
              ? present
              : params.op === 'absent'
                ? !present
                : params.op === 'equals'
                  ? present && shown(value) === params.value
                  : present && valuePattern.test(shown(value));
          return ok
            ? {verdict: 'passed', note: present ? shown(value).slice(0, 80) : 'absent'}
            : {verdict: 'failed', note: present ? shown(value).slice(0, 80) : 'absent'};
        }
        case 'noFlags': {
          const red = exchange.status >= 400 || exchange.flags?.some((flag) => RED_FLAGS.has(flag));
          return red ? {verdict: 'failed', note: `status ${exchange.status}`} : null;
        }
        default:
          return null;
      }
    },
    onLog(entry) {
      if (type !== 'log' || entry.kind === 'marker') {
        return null;
      }
      if (params.tag && entry.tag !== params.tag) {
        return null;
      }
      if (params.level && levels.indexOf(entry.level) < levels.indexOf(params.level)) {
        return null;
      }
      if (!pattern.test(entry.message ?? '')) {
        return null;
      }
      return params.mode === 'notSeen'
        ? {verdict: 'failed', note: String(entry.message).split('\n')[0].slice(0, 120)}
        : {verdict: 'passed', note: String(entry.message).split('\n')[0].slice(0, 120)};
    },
    onScreen(screen) {
      if (type !== 'screen') {
        return null;
      }
      const sameScreen = String(screen.title ?? '').toLowerCase() === params.screen.toLowerCase();
      const sameState = !params.state || String(screen.state ?? '').toLowerCase() === params.state.toLowerCase();
      return sameScreen && sameState ? {verdict: 'passed'} : null;
    },
  };
}

/** The state a goal starts a run in. */
export const initialState = (goal) =>
  goal.type === 'manual'
    ? {state: 'manual'}
    : goal.type === 'noFlags' || (goal.type === 'log' && goal.params.mode === 'notSeen')
      ? {state: 'holding'}
      : {state: 'pending'};

/**
 * A run of the goals over one session. Each event goes to every goal; a
 * "must not happen" goal fails for good once broken; a "should happen" goal
 * passes on a fitting event and may still pass after a failure.
 */
export function createGoalRun(goals, {startedAt = new Date().toISOString(), ...meta} = {}) {
  // the device and app may be known only a moment after the run starts
  const info = {device: meta.device ?? null, app: meta.app ?? null, build: meta.build ?? null};
  const compiled = goals.filter((goal) => !goalProblem(goal)).map(compileGoal);
  const states = Object.fromEntries(goals.map((goal) => [goal.id, initialState(goal)]));

  const mark = (goal, verdict, evidence) => {
    const before = states[goal.id];
    const mustNot = before.state === 'holding' || (before.state === 'failed' && before.final);
    if (mustNot) {
      if (verdict.verdict === 'failed' && !before.final) {
        states[goal.id] = {state: 'failed', final: true, evidence, note: verdict.note, at: evidence.at};
        return true;
      }
      return false;
    }
    if (before.state === 'passed') {
      return false;
    }
    states[goal.id] = {state: verdict.verdict, evidence, note: verdict.note, at: evidence.at};
    return true;
  };

  const feed = (method, payload, evidence) => {
    let changed = false;
    for (const one of compiled) {
      const verdict = one[method](payload);
      if (verdict) {
        changed = mark(one.goal, verdict, evidence) || changed;
      }
    }
    return changed;
  };

  return {
    startedAt,
    get device() {
      return info.device;
    },
    /** Fills in what was not known when the run started. */
    describe(next) {
      for (const key of Object.keys(info)) {
        info[key] = info[key] ?? next?.[key] ?? null;
      }
    },
    onExchange: (exchange) =>
      feed('onExchange', exchange, {
        kind: 'request',
        id: exchange.id,
        label: `${exchange.method} ${endpointOf(exchange.url).path} ${exchange.status ?? ''}`.trim(),
        at: new Date(exchange.startedAt ?? Date.now()).toISOString(),
      }),
    onLog: (entry) =>
      feed('onLog', entry, {
        kind: 'log',
        id: String(entry.seq ?? ''),
        label: `${entry.level} ${entry.tag}`,
        at: new Date().toISOString(),
      }),
    onScreen: (screen) =>
      feed('onScreen', screen, {
        kind: 'screen',
        id: screen.key ?? screen.title,
        label: [screen.title, screen.state].filter(Boolean).join(' · '),
        at: new Date().toISOString(),
      }),
    /** A manual goal ticked or unticked by the person. */
    setManual(goalId, done) {
      if (states[goalId]) {
        states[goalId] = done
          ? {state: 'passed', at: new Date().toISOString(), evidence: {kind: 'manual'}}
          : {state: 'manual'};
      }
    },
    states: () => states,
    snapshot: () => ({startedAt, ...info, states: structuredClone(states)}),
  };
}

/** How a run stands: how many passed, failed, wait, hold. */
export function runCounts(goals, states) {
  const counts = {total: goals.length, passed: 0, failed: 0, pending: 0, holding: 0, manual: 0};
  for (const goal of goals) {
    counts[states?.[goal.id]?.state ?? 'pending']++;
  }
  return counts;
}

const STATE_MARK = {passed: '✅', failed: '❌', pending: '⏳', holding: '🟢', manual: '☐'};

/**
 * The report of a run in Markdown, for the clipboard or a comment in the
 * task: the task, the build and device, each goal with its state and evidence.
 * @param {object} labels the words of the person's language
 */
export function goalReport({task, run, goals, labels}) {
  const counts = runCounts(goals, run.states);
  const lines = [
    `## ${labels.title}: ${task.key} ${task.summary ?? ''}`.trim(),
    '',
    `- ${labels.when}: ${new Date(run.startedAt).toLocaleString()}`,
    run.app ? `- ${labels.app}: ${run.app}${run.build ? ` (${run.build})` : ''}` : null,
    run.device ? `- ${labels.device}: ${run.device}` : null,
    `- ${labels.result}: ${counts.passed}/${counts.total} ${labels.passed}, ${counts.failed} ${labels.failed}`,
    '',
    ...goals.map((goal) => {
      const state = run.states?.[goal.id] ?? {state: 'pending'};
      const evidence = state.evidence?.label ? ` — ${state.evidence.label}` : '';
      const note = state.note ? ` (${state.note})` : '';
      return `- ${STATE_MARK[state.state] ?? ''} ${goal.title}: ${labels.states[state.state] ?? state.state}${evidence}${note}`;
    }),
  ];
  return lines.filter((line) => line !== null).join('\n');
}
