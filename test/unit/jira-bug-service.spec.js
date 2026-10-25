import {describe, expect, it} from 'vitest';

import {JiraBugService} from '../../app/common/node/jira/bug-service.js';

const violation = {
  id: 'missing-label|id:btn_scan_qr',
  rule: 'missing-label',
  severity: 'error',
  title: 'Control has no label',
  message: 'ImageButton (id/btn_scan_qr) has nothing for TalkBack to read out.',
  nodeKey: 'id:com.bank.app:id/btn_scan_qr',
  resourceId: 'com.bank.app:id/btn_scan_qr',
  className: 'android.widget.ImageButton',
  label: '',
  bounds: {x: 930, y: 618, width: 90, height: 90},
  details: {element: 'ImageButton (id/btn_scan_qr)'},
};

const problem = {
  code: 'a11y-3f9c2a1b',
  component: 'btn_scan_qr',
  everyScreen: true,
  markers: ['a11y-3f9c2a1b', 'a11y-missing-label', 'a11y-component-btn_scan_qr'],
  markerQuery: ['a11y-missing-label', 'a11y-component-btn_scan_qr'],
};

const request = {
  violations: [violation],
  problem,
  block: 'Платежі',
  screen: 'Оплата',
  device: 'Pixel 6 · Android 12',
  app: 'com.bank.app',
  locators: ['id: com.bank.app:id/btn_scan_qr'],
  parentKey: 'pay-42',
  screenshotPng: Buffer.from('png').toString('base64'),
};

/**
 * A Jira Cloud that knows one task, PAY-42, in a project whose bug sub-task
 * needs a severity and a customer copied from the task.
 */
function fakeJira(searchResults = null) {
  const calls = [];
  const json = (body, status = 200) => ({ok: status < 400, status, text: async () => JSON.stringify(body)});
  const fetchImpl = async (url, init = {}) => {
    const path = url.replace('https://bank.atlassian.net', '');
    calls.push({method: init.method ?? 'GET', path, body: init.body, headers: init.headers});
    if (path === '/rest/api/2/issue/PAY-42') {
      return json({
        key: 'PAY-42',
        fields: {
          summary: 'Payments redesign',
          project: {key: 'PAY'},
          assignee: {accountId: 'acc-1', displayName: 'Olena'},
          customfield_200: {id: '7', value: 'Retail'},
        },
      });
    }
    if (path.startsWith('/rest/api/2/issue/createmeta/PAY/issuetypes/11')) {
      return json({
        fields: [
          {fieldId: 'summary', name: 'Summary', required: true, schema: {type: 'string'}},
          {fieldId: 'description', name: 'Description', required: false, schema: {type: 'string'}},
          {fieldId: 'parent', name: 'Parent', required: true, schema: {type: 'issuelink'}},
          {fieldId: 'assignee', name: 'Assignee', required: false, schema: {type: 'user'}},
          {fieldId: 'labels', name: 'Labels', required: false, schema: {type: 'array', items: 'string'}},
          {
            fieldId: 'customfield_100',
            name: 'Серйозність',
            required: true,
            schema: {type: 'option'},
            allowedValues: [
              {id: '1', value: 'S3'},
              {id: '2', value: 'S4'},
            ],
          },
          {
            fieldId: 'customfield_200',
            name: 'Замовник',
            required: true,
            schema: {type: 'option'},
            allowedValues: [{id: '7', value: 'Retail'}],
          },
        ],
        total: 7,
      });
    }
    if (path.startsWith('/rest/api/2/issue/createmeta/PAY/issuetypes')) {
      return json({
        issueTypes: [
          {id: '10', name: 'Task', subtask: false},
          {id: '11', name: 'Помилка', subtask: true},
        ],
        total: 2,
      });
    }
    if (path === '/rest/api/2/issueLinkType') {
      return json({issueLinkTypes: [{name: 'Relates', inward: 'relates to', outward: 'relates to'}]});
    }
    if (path === '/rest/api/2/issue' && init.method === 'POST') {
      return json({key: 'PAY-77'}, 201);
    }
    if (path === '/rest/api/2/issue/PAY-77/attachments') {
      return json([]);
    }
    if (path.startsWith('/rest/api/2/search/jql')) {
      const jql = decodeURIComponent(path.split('jql=')[1].split('&')[0]);
      return json({issues: (searchResults ?? (() => []))(jql)});
    }
    if (/^\/rest\/api\/2\/issue\/PAY-\d+$/.test(path) && init.method === 'PUT') {
      return json({}, 204);
    }
    return json({errorMessages: [`unexpected ${path}`]}, 404);
  };
  return {calls, fetchImpl};
}

const service = (fetchImpl, settings = {url: 'https://bank.atlassian.net', email: 'qa@bank.ua'}) =>
  new JiraBugService({getSettings: async () => settings, getToken: async () => 'token', fetchImpl});

describe('JiraBugService', function () {
  it('prepares a sub-task under the task with the fields copied from it', async function () {
    const {fetchImpl} = fakeJira();
    const prep = await service(fetchImpl).prepare(request);
    expect(prep.ok).toBe(true);
    expect(prep.parent).toMatchObject({key: 'PAY-42', projectKey: 'PAY', assignee: 'Olena'});
    expect(prep.issueTypeId).toBe('11');
    expect(prep.summary).toBe(
      '[A11y] Платежі. Оплата: Control has no label (com.bank.app:id/btn_scan_qr) [a11y-3f9c2a1b]',
    );
    expect(prep.markers).toEqual(problem.markers);
    expect(prep.inJira).toEqual([]);
    expect(prep.filled).toEqual(
      expect.arrayContaining([
        {field: 'Parent', value: 'PAY-42', source: 'task'},
        {field: 'Assignee', value: 'Olena', source: 'task'},
        {
          field: 'Labels',
          value: 'accessibility, vision, a11y-3f9c2a1b, a11y-missing-label, a11y-component-btn_scan_qr',
          source: 'vision',
        },
      ]),
    );
    expect(prep.missing).toEqual([]);
  });

  it('files the bug, attaches the outlined screenshot and returns its key', async function () {
    const {calls, fetchImpl} = fakeJira();
    const result = await service(fetchImpl).file(request);
    expect(result).toEqual({
      ok: true,
      key: 'PAY-77',
      url: 'https://bank.atlassian.net/browse/PAY-77',
      code: 'a11y-3f9c2a1b',
      alreadyFiled: false,
      duplicates: [],
      warnings: [],
    });

    const created = JSON.parse(calls.find((call) => call.path === '/rest/api/2/issue' && call.method === 'POST').body);
    expect(created.fields).toMatchObject({
      project: {key: 'PAY'},
      issuetype: {id: '11'},
      parent: {key: 'PAY-42'},
      assignee: {accountId: 'acc-1'},
      labels: ['accessibility', 'vision', ...problem.markers],
      customfield_100: {id: '2'},
      customfield_200: {id: '7'},
    });
    expect(created.fields.description).toContain('||Локатор|id: com.bank.app:id/btn_scan_qr|');
    expect(created.fields.summary.endsWith('[a11y-3f9c2a1b]')).toBe(true);
    // a sub-task is not linked again, and the screenshot is attached
    expect(calls.some((call) => call.path.startsWith('/rest/api/2/issueLink'))).toBe(false);
    expect(calls.some((call) => call.path === '/rest/api/2/issue/PAY-77/attachments')).toBe(true);
    expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from('qa@bank.ua:token').toString('base64')}`);
  });

  it('explains what is missing before Jira is set up, and passes Jira errors on', async function () {
    const {fetchImpl} = fakeJira();
    const notSetUp = await service(fetchImpl, {url: '', email: ''}).prepare(request);
    expect(notSetUp).toMatchObject({ok: false, error: expect.stringContaining('Jira is not set up')});

    const unknownTask = await service(fetchImpl).prepare({...request, parentKey: 'PAY-1'});
    expect(unknownTask).toMatchObject({ok: false, error: expect.stringContaining('404')});
  });

  const found = (key, labels, extra = {}) => ({
    key,
    fields: {summary: `Bug ${key}`, status: {name: 'Open', statusCategory: {key: 'new'}}, labels, ...extra},
  });

  it('links an open bug Jira has for the problem instead of filing another, and marks it', async function () {
    const {calls, fetchImpl} = fakeJira(() => [found('PAY-50', ['a11y-missing-label', 'a11y-component-btn_scan_qr'])]);
    const result = await service(fetchImpl).file(request);
    expect(result).toMatchObject({ok: true, key: 'PAY-50', alreadyFiled: true});
    expect(calls.some((call) => call.path === '/rest/api/2/issue' && call.method === 'POST')).toBe(false);
    const edit = calls.find((call) => call.path === '/rest/api/2/issue/PAY-50' && call.method === 'PUT');
    expect(JSON.parse(edit.body).update.labels).toEqual([
      ...problem.markers.map((label) => ({add: label})),
      {remove: 'a11y-unlinked-3f9c2a1b'},
    ]);
  });

  it('does not take a bug that was unlinked from the problem, nor a done one', async function () {
    const unlinked = found('PAY-51', ['a11y-3f9c2a1b', 'a11y-unlinked-3f9c2a1b']);
    const done = found('PAY-52', ['a11y-3f9c2a1b'], {status: {name: 'Done', statusCategory: {key: 'done'}}});
    const {fetchImpl} = fakeJira(() => [unlinked, done]);
    const result = await service(fetchImpl).file(request);
    expect(result).toMatchObject({ok: true, key: 'PAY-77', alreadyFiled: false});
    expect(result.warnings).toEqual(['a11y-3f9c2a1b was filed before as PAY-52 (done)']);
  });

  it('warns about a bug a colleague filed for the problem in the same moment', async function () {
    const {fetchImpl} = fakeJira((jql) =>
      jql.startsWith('labels = "a11y-3f9c2a1b" AND key !=') ? [found('PAY-78', ['a11y-3f9c2a1b'])] : [],
    );
    const result = await service(fetchImpl).file(request);
    expect(result.duplicates).toEqual([{key: 'PAY-78', url: 'https://bank.atlassian.net/browse/PAY-78'}]);
  });

  it("looks a screen's problems up in one search, by id or by markers", async function () {
    const {calls, fetchImpl} = fakeJira(() => [
      found('PAY-60', ['a11y-missing-label', 'a11y-component-btn_scan_qr']),
      found('PAY-61', ['a11y-0000aaaa']),
    ]);
    const other = {code: 'a11y-0000aaaa', markerQuery: null};
    const result = await service(fetchImpl).lookup({
      items: [
        {group: 'g1', ...problem},
        {group: 'g2', ...other},
        {group: 'g3', code: 'a11y-ffffffff', markerQuery: null},
      ],
      unlinkedKeys: [],
    });
    expect(result).toEqual({
      ok: true,
      found: [
        {group: 'g1', code: 'a11y-3f9c2a1b', key: 'PAY-60', url: 'https://bank.atlassian.net/browse/PAY-60'},
        {group: 'g2', code: 'a11y-0000aaaa', key: 'PAY-61', url: 'https://bank.atlassian.net/browse/PAY-61'},
      ],
    });
    expect(calls.filter((call) => call.path.startsWith('/rest/api/2/search/jql'))).toHaveLength(1);
  });

  it('unlinks a bug: takes the problem labels off and marks it unlinked', async function () {
    const {calls, fetchImpl} = fakeJira(() => [
      found('PAY-50', ['accessibility', 'a11y-3f9c2a1b', 'a11y-missing-label']),
    ]);
    expect(await service(fetchImpl).unlink({jiraKey: 'PAY-50', code: 'a11y-3f9c2a1b'})).toEqual({
      ok: true,
      warnings: [],
    });
    const edit = calls.find((call) => call.method === 'PUT');
    expect(JSON.parse(edit.body).update.labels).toEqual([
      {add: 'a11y-unlinked-3f9c2a1b'},
      {remove: 'a11y-3f9c2a1b'},
      {remove: 'a11y-missing-label'},
    ]);
  });
});
