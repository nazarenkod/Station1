import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {taskTools} from '../../app/common/node/agent/task-tools.js';
import {createTaskStore} from '../../app/common/node/task/store.js';
import {cleanGoal, createGoalRun, goalProblem, goalReport, runCounts} from '../../app/common/shared/agent/goals.js';

const exchange = (id, patch = {}) => ({
  id,
  method: 'POST',
  url: 'https://api.bank.ua/v2/transfers',
  startedAt: Date.parse('2026-10-27T12:00:00Z'),
  status: 201,
  flags: [],
  requestHeaders: {'x-request-id': 'r-1'},
  requestBody: JSON.stringify({amount: 100, purpose: 'rent'}),
  responseHeaders: {},
  responseBody: JSON.stringify({id: 'tx-1', items: [{id: 7}]}),
  ...patch,
});

const goal = (type, params, extra = {}) => cleanGoal({type, title: `${type} goal`, params, ...extra});

describe('a goal', () => {
  it('keeps what its type needs, a title and where it came from', () => {
    const one = cleanGoal({
      type: 'field',
      title: 'У POST /v2/transfers є purpose',
      source: 'impact',
      expectOn: 'Переказ',
      itemId: 'check-abc',
      params: {
        method: 'post',
        path: '*/v2/transfers',
        where: 'request.body',
        field: 'purpose',
        op: 'exists',
        screen: 'x',
      },
    });
    expect(one).toMatchObject({
      type: 'field',
      source: 'impact',
      expectOn: 'Переказ',
      itemId: 'check-abc',
      params: {
        method: 'POST',
        path: '*/v2/transfers',
        where: 'request.body',
        field: 'purpose',
        op: 'exists',
        value: '',
      },
    });
    expect(one.params.screen).toBeUndefined();
    expect(cleanGoal({type: 'nonsense'}).type).toBe('manual');
  });

  it('says what is missing before it can be counted', () => {
    expect(goalProblem(goal('request', {path: ''}))).toBe('path');
    expect(goalProblem(goal('field', {path: '*/x', field: 'a', op: 'equals'}))).toBe('value');
    expect(goalProblem(goal('log', {pattern: '('}))).toBe('pattern');
    expect(goalProblem(cleanGoal({type: 'manual'}))).toBe('title');
    expect(goalProblem(goal('screen', {screen: 'Переказ'}))).toBeNull();
  });
});

describe('counting goals on a session', () => {
  it('passes a goal on the request that fits, with the request as evidence', () => {
    const goals = [goal('request', {method: 'POST', path: '*/v2/transfers'}, {id: 'g1'})];
    const run = createGoalRun(goals);
    expect(run.states().g1.state).toBe('pending');
    expect(run.onExchange(exchange('a', {url: 'https://api.bank.ua/v2/limits'}))).toBe(false);
    expect(run.onExchange(exchange('b'))).toBe(true);
    expect(run.states().g1).toMatchObject({
      state: 'passed',
      evidence: {kind: 'request', id: 'b', label: 'POST /v2/transfers 201'},
    });
  });

  it('fails a field goal on a request without the field, and passes it on a later one with it', () => {
    const goals = [
      goal(
        'field',
        {method: 'POST', path: '*/v2/transfers', where: 'request.body', field: 'purpose', op: 'exists'},
        {id: 'g1'},
      ),
    ];
    const run = createGoalRun(goals);
    run.onExchange(exchange('a', {requestBody: JSON.stringify({amount: 1})}));
    expect(run.states().g1).toMatchObject({state: 'failed', note: 'absent', evidence: {id: 'a'}});
    run.onExchange(exchange('b'));
    expect(run.states().g1).toMatchObject({state: 'passed', note: 'rent', evidence: {id: 'b'}});
  });

  it('checks values, patterns, headers, query and the response', () => {
    const goals = [
      goal(
        'field',
        {path: '*/transfers', where: 'request.body', field: 'amount', op: 'equals', value: '100'},
        {id: 'eq'},
      ),
      goal(
        'field',
        {path: '*/transfers', where: 'response.body', field: 'items[0].id', op: 'matches', value: '^\\d+$'},
        {id: 'rx'},
      ),
      goal('field', {path: '*/transfers', where: 'request.header', field: 'X-Request-Id', op: 'exists'}, {id: 'hd'}),
      goal('field', {path: '*/transfers', where: 'request.query', field: 'debug', op: 'absent'}, {id: 'q'}),
      goal('status', {path: '*/transfers', status: '2xx'}, {id: 'st'}),
    ];
    const run = createGoalRun(goals);
    run.onExchange(exchange('a'));
    expect(Object.values(run.states()).map((one) => one.state)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
    ]);
  });

  it('holds a goal that must not happen until it is broken, then fails it for good', () => {
    const goals = [
      goal('noFlags', {path: '*/v2/transfers'}, {id: 'nf'}),
      goal('log', {pattern: 'FATAL EXCEPTION', mode: 'notSeen'}, {id: 'nl'}),
    ];
    const run = createGoalRun(goals);
    run.onExchange(exchange('ok'));
    run.onLog({seq: 1, level: 'I', tag: 'App', message: 'started'});
    expect(runCounts(goals, run.states())).toMatchObject({holding: 2, failed: 0});
    run.onExchange(exchange('bad', {status: 500}));
    run.onLog({seq: 2, level: 'E', tag: 'AndroidRuntime', message: 'FATAL EXCEPTION: main'});
    run.onExchange(exchange('ok2'));
    expect(run.states().nf).toMatchObject({state: 'failed', evidence: {id: 'bad'}});
    expect(run.states().nl).toMatchObject({state: 'failed', note: 'FATAL EXCEPTION: main'});
  });

  it('passes a log goal from a level up and for its tag, and a screen goal in its state', () => {
    const goals = [
      goal('log', {pattern: 'payment (ok|done)', level: 'I', tag: 'Pay'}, {id: 'lg'}),
      goal('screen', {screen: 'Переказ', state: 'діалог: Підтвердіть'}, {id: 'sc'}),
    ];
    const run = createGoalRun(goals);
    run.onLog({seq: 1, level: 'D', tag: 'Pay', message: 'payment ok'});
    run.onLog({seq: 2, level: 'I', tag: 'Other', message: 'payment ok'});
    expect(run.states().lg.state).toBe('pending');
    run.onLog({seq: 3, level: 'W', tag: 'Pay', message: 'payment done'});
    expect(run.states().lg.state).toBe('passed');
    run.onScreen({key: 'pay', title: 'Переказ', state: null});
    expect(run.states().sc.state).toBe('pending');
    run.onScreen({key: 'pay', title: 'Переказ', state: 'діалог: Підтвердіть'});
    expect(run.states().sc).toMatchObject({
      state: 'passed',
      evidence: {kind: 'screen', label: 'Переказ · діалог: Підтвердіть'},
    });
  });

  it('ticks a manual goal by hand', () => {
    const goals = [cleanGoal({id: 'm', type: 'manual', title: 'Поглянути на анімацію'})];
    const run = createGoalRun(goals);
    expect(run.states().m.state).toBe('manual');
    run.setManual('m', true);
    expect(run.states().m.state).toBe('passed');
  });

  it('keeps up with 10 000 requests and log lines against 50 goals, under 1 ms an event', () => {
    const goals = Array.from({length: 50}, (_, index) =>
      index % 2
        ? goal(
            'field',
            {path: `*/v2/endpoint${index}`, where: 'request.body', field: 'purpose', op: 'exists'},
            {id: `g${index}`},
          )
        : goal('log', {pattern: `marker-${index}`, mode: index % 4 ? 'seen' : 'notSeen'}, {id: `g${index}`}),
    );
    const run = createGoalRun(goals);
    const started = performance.now();
    for (let index = 0; index < 5000; index++) {
      run.onExchange(exchange(`x${index}`, {url: `https://api.bank.ua/v2/endpoint${index % 60}`}));
      run.onLog({seq: index, level: 'I', tag: 'App', message: `line ${index} with some text marker-${index % 70}`});
    }
    const perEvent = (performance.now() - started) / 10000;
    expect(perEvent).toBeLessThan(1);
  });
});

describe('the report of a run', () => {
  it('names the task, the app and device, and each goal with its state and evidence', () => {
    const goals = [
      goal('request', {path: '*/v2/transfers'}, {id: 'g1', title: 'Переказ надіслано'}),
      goal('noFlags', {path: '*/v2/limits'}, {id: 'g2', title: 'Ліміти без помилок'}),
    ];
    const run = createGoalRun(goals, {startedAt: '2026-10-27T12:00:00Z'});
    // the device and app may come a moment after the run starts
    run.describe({device: 'Pixel 8', app: 'ua.bank', build: '5.12.0'});
    run.onExchange(exchange('a'));
    const labels = {
      title: 'Цілі сесії',
      when: 'Прогін',
      app: 'Застосунок',
      device: 'Пристрій',
      result: 'Результат',
      passed: 'виконано',
      failed: 'не виконано',
      states: {
        passed: 'виконано',
        failed: 'не виконано',
        pending: 'очікує',
        holding: 'поки тримається',
        manual: 'вручну',
      },
    };
    const text = goalReport({task: {key: 'PAY-1', summary: 'Переказ за IBAN'}, run: run.snapshot(), goals, labels});
    expect(text.split('\n')[0]).toBe('## Цілі сесії: PAY-1 Переказ за IBAN');
    expect(text).toContain('- Застосунок: ua.bank (5.12.0)');
    expect(text).toContain('- Пристрій: Pixel 8');
    expect(text).toContain('- Результат: 1/2 виконано, 0 не виконано');
    expect(text).toContain('- ✅ Переказ надіслано: виконано — POST /v2/transfers 201');
    expect(text).toContain('- 🟢 Ліміти без помилок: поки тримається');
  });
});

describe('goals kept with the task', () => {
  let dir;
  afterEach(() => rm(dir, {recursive: true, force: true}));

  it('keeps the goals and the last twenty runs, the running one replaced as it goes', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'station-goals-'));
    const settings = new Map();
    const store = createTaskStore({
      dir,
      get: async (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      settingKey: 'TASKS',
    });
    await store.setGoals('p1', 'PAY-1', [goal('request', {path: '*/x'}, {id: 'g1'})]);
    await store.saveRun('p1', 'PAY-1', {id: 'run-a', states: {g1: {state: 'pending'}}});
    await store.saveRun('p1', 'PAY-1', {id: 'run-a', states: {g1: {state: 'passed'}}});
    for (let index = 0; index < 25; index++) {
      await store.saveRun('p1', 'PAY-1', {id: `run-${index}`, states: {}});
    }
    const data = await store.load('p1', 'PAY-1');
    expect(data.goals.map((one) => one.id)).toEqual(['g1']);
    expect(data.goalRuns).toHaveLength(20);
    expect(data.goalRuns[0].id).toBe('run-24');
  });

  it('lets the agent propose a goal, never add one', async () => {
    const proposals = [];
    const tools = taskTools({
      current: async () => ({profileId: 'p1', key: 'PAY-1'}),
      store: {load: async () => null},
      turnOf: () => 1,
      onChanged: () => {},
      proposeGoal: (proposal) => proposals.push(proposal),
    });
    const propose = tools.find((tool) => tool.name === 'goal_propose');
    expect(propose.autoAllow).toBe(true);
    expect(await propose.run({title: 'x', type: 'field', path: '*/t'}, {conversation: 'c'})).toMatch(
      /Not proposed: field/,
    );
    const answer = await propose.run(
      {
        title: 'У POST /v2/transfers є purpose',
        type: 'field',
        method: 'POST',
        path: '*/v2/transfers',
        field: 'purpose',
        op: 'exists',
        itemId: 'check-1',
      },
      {conversation: 'c'},
    );
    expect(answer).toMatch(/counts only if they accept it/);
    expect(proposals[0]).toMatchObject({
      key: 'PAY-1',
      goal: {type: 'field', source: 'agent', itemId: 'check-1', params: {field: 'purpose'}},
    });
  });
});
