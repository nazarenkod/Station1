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

const request = {
  violation,
  block: 'Платежі',
  screen: 'Оплата',
  device: 'Pixel 6 · Android 12',
  app: 'com.bank.app',
  locator: 'id: com.bank.app:id/btn_scan_qr',
  parentKey: 'pay-42',
  screenshotPng: Buffer.from('png').toString('base64'),
};

/**
 * A Jira Cloud that knows one task, PAY-42, in a project whose bug sub-task
 * needs a severity and a customer copied from the task.
 */
function fakeJira() {
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
    expect(prep.summary).toBe('[A11y] Платежі. Оплата: Control has no label (com.bank.app:id/btn_scan_qr)');
    expect(prep.filled).toEqual(
      expect.arrayContaining([
        {field: 'Parent', value: 'PAY-42', source: 'task'},
        {field: 'Assignee', value: 'Olena', source: 'task'},
        {field: 'Labels', value: 'accessibility, vision', source: 'vision'},
      ]),
    );
    expect(prep.missing).toEqual([]);
  });

  it('files the bug, attaches the outlined screenshot and returns its key', async function () {
    const {calls, fetchImpl} = fakeJira();
    const result = await service(fetchImpl).file(request);
    expect(result).toEqual({ok: true, key: 'PAY-77', url: 'https://bank.atlassian.net/browse/PAY-77', warnings: []});

    const created = JSON.parse(calls.find((call) => call.path === '/rest/api/2/issue' && call.method === 'POST').body);
    expect(created.fields).toMatchObject({
      project: {key: 'PAY'},
      issuetype: {id: '11'},
      parent: {key: 'PAY-42'},
      assignee: {accountId: 'acc-1'},
      labels: ['accessibility', 'vision'],
      customfield_100: {id: '2'},
      customfield_200: {id: '7'},
    });
    expect(created.fields.description).toContain('||Локатор|id: com.bank.app:id/btn_scan_qr|');
    // a sub-task is not linked again, and the screenshot is attached
    expect(calls.some((call) => call.path === '/rest/api/2/issueLink')).toBe(false);
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
});
