// Ported from vision: keep in sync until both use a shared package.
import {describe, expect, it} from 'vitest';

import type {JiraField, JiraIssueType, JiraParentIssue} from '../../app/common/node/jira/client';
import {
  bugText,
  buildBugFields,
  copyValue,
  defaultIssueType,
  functionalBlock,
  inspectorBugText,
} from '../../app/common/renderer/lib/a11y/jira-bug';
import type {A11yViolation} from '../../app/common/renderer/lib/a11y/types';

const violation: A11yViolation = {
  id: 'touch-target|id:btn',
  rule: 'touch-target',
  severity: 'warning',
  title: 'Touch target too small',
  message: 'Button "Надати дані" (id/btn) is 347 × 40 dp, minimum is 48 × 48 dp.',
  nodeKey: 'id:btn',
  resourceId: 'ua.bank:id/btn',
  className: 'android.widget.Button',
  label: 'Надати дані',
  bounds: {x: 0, y: 0, width: 10, height: 10},
};

const problem = {code: 'a11y-3f9c2a1b', component: null, everyScreen: false};

const field = (id: string, name: string, extra: Partial<JiraField> = {}): JiraField => ({
  id,
  name,
  required: false,
  schema: {type: 'string'},
  ...extra,
});

const subtask: JiraIssueType = {id: '10', name: 'Помилка', subtask: true};
const bugType: JiraIssueType = {id: '1', name: 'Bug', subtask: false};

const parent = (
  fields: Record<string, unknown> = {},
  assignee: JiraParentIssue['assignee'] = null,
): JiraParentIssue => ({
  key: 'P24MOB-14136',
  summary: 'Адреса',
  projectKey: 'P24MOB',
  assignee,
  fields,
});

describe('functionalBlock', () => {
  it('takes the service from the check name before the first dot', () => {
    expect(functionalBlock('Кредитна сила - Кредит готівкою. Деталі договору - інфоблок')).toBe(
      'Кредитна сила - Кредит готівкою',
    );
    expect(functionalBlock('Login')).toBe('Login');
  });
});

describe('bugText', () => {
  it('fills the template: service, screen, actual and expected result', () => {
    const text = bugText({
      violations: [violation],
      testName: 'Кредитна сила - Кредит готівкою. Деталі договору',
      title: 'Адреса проживання',
      device: 'PIXEL_4_XL · 15',
      url: 'http://vision/x',
      problem,
    });
    expect(text.summary).toBe(
      '[A11y] Кредитна сила - Кредит готівкою. Адреса проживання: Touch target too small (Надати дані) [a11y-3f9c2a1b]',
    );
    expect(text.description).toContain('h3. Фактичний результат\n' + violation.message);
    expect(text.description).toContain('h3. Очікуваний результат\nОбласть натискання не менше 48 × 48 dp');
    expect(text.description).toContain('||Сервіс / функціональний блок|Кредитна сила - Кредит готівкою|');
    expect(text.description).toContain('[Відкрити у Vision|http://vision/x]');
  });

  it('falls back to the check name for the screen when the tree has no title', () => {
    const text = bugText({
      violations: [violation],
      testName: 'Конверти. Текст суми',
      title: null,
      device: '',
      url: 'u',
      problem,
    });
    expect(text.screen).toBe('Текст суми');
    expect(
      bugText({violations: [violation], testName: 'Payments', title: null, device: '', url: 'u', problem}).summary,
    ).toBe('[A11y] Payments: Touch target too small (Надати дані) [a11y-3f9c2a1b]');
  });
});

describe('bugText for one problem on several elements', () => {
  it('names them all once and lists every element as the actual result', () => {
    const second = {
      ...violation,
      id: 'touch-target|id:b2',
      label: 'Надати дані 2',
      message: 'Button 2 is 347 × 40 dp.',
    };
    const third = {
      ...violation,
      id: 'touch-target|id:b3',
      label: 'Надати дані 3',
      message: 'Button 3 is 347 × 40 dp.',
    };
    const text = bugText({
      violations: [violation, second, third],
      testName: 'Адреси. Екран',
      title: null,
      device: '',
      url: 'u',
      problem,
    });
    expect(text.summary).toBe(
      '[A11y] Адреси. Екран: Touch target too small (Надати дані, Надати дані 2 +1) [a11y-3f9c2a1b]',
    );
    expect(text.description).toContain('Та сама проблема на 3 елементах одного компонента:');
    expect(text.description).toContain('# Button 3 is 347 × 40 dp.');
    expect(text.description).toContain('проблемні елементи обведено');
  });
});

describe('problem id in the bug', () => {
  it('goes into the summary and the description, with the component', () => {
    const text = bugText({
      violations: [violation],
      testName: 'Адреси. Екран',
      title: null,
      device: '',
      url: 'u',
      problem: {code: 'a11y-3f9c2a1b', component: 'PbButton', everyScreen: true},
    });
    expect(text.summary.endsWith(' [a11y-3f9c2a1b]')).toBe(true);
    expect(text.description).toContain('||ID проблеми (Vision)|a11y-3f9c2a1b|');
    expect(text.description).toContain('||Компонент|PbButton|');
    expect(text.description).toContain('Проблема компонента PbButton');
    expect(text.description).toContain('labels = a11y-3f9c2a1b');
  });

  it('keeps the id whole in a long summary', () => {
    const long = bugText({
      violations: [{...violation, label: 'x'.repeat(400)}],
      testName: 'A',
      title: null,
      device: '',
      url: 'u',
      problem,
    });
    expect(long.summary.length).toBeLessThanOrEqual(250);
    expect(long.summary.endsWith('[a11y-3f9c2a1b]')).toBe(true);
  });
});

describe('defaultIssueType', () => {
  it('prefers the configured type, then a bug sub-task, then a bug', () => {
    const types = [{id: '1', name: 'Task', subtask: false}, bugType, subtask];
    expect(defaultIssueType(types, 'task')?.id).toBe('1');
    expect(defaultIssueType(types)?.id).toBe('10');
    expect(defaultIssueType([bugType, {id: '3', name: 'Sub-task', subtask: true}])?.id).toBe('1');
  });
});

describe('buildBugFields', () => {
  const base = {summary: 'S', description: 'D', labels: ['accessibility'], severity: 'S4'};

  it('puts a sub-task under the task instead of linking it', () => {
    const bug = buildBugFields({
      ...base,
      meta: [field('summary', 'Summary', {required: true}), field('description', 'Description')],
      parent: parent(),
      issueType: subtask,
    });
    expect(bug.fields).toEqual({
      project: {key: 'P24MOB'},
      issuetype: {id: '10'},
      summary: 'S',
      description: 'D',
      parent: {key: 'P24MOB-14136'},
    });
    expect(bug.missing).toEqual([]);
  });

  it('gives it to the task assignee, on the create screen or right after', () => {
    const assignee = {name: 'svitlychnyi', displayName: 'Денис Світличний'};
    const onScreen = buildBugFields({
      ...base,
      meta: [field('assignee', 'Assignee')],
      parent: parent({}, assignee),
      issueType: bugType,
    });
    expect(onScreen.fields.assignee).toEqual({name: 'svitlychnyi'});
    expect(onScreen.assignAfter).toBeNull();
    const notOnScreen = buildBugFields({...base, meta: [], parent: parent({}, assignee), issueType: bugType});
    expect(notOnScreen.fields.assignee).toBeUndefined();
    expect(notOnScreen.assignAfter).toEqual(assignee);
    const cloud = buildBugFields({
      ...base,
      meta: [field('assignee', 'Assignee')],
      parent: parent({}, {accountId: 'abc', displayName: 'X'}),
      issueType: bugType,
    });
    expect(cloud.fields.assignee).toEqual({accountId: 'abc'});
  });

  it('sets severity S4, copies the customer and other required fields from the task', () => {
    const meta = [
      field('customfield_1', 'Серйозність помилки', {
        required: true,
        schema: {type: 'option'},
        allowedValues: ['S1', 'S2', 'S3', 'S4', 'S5', 'SC'].map((value, i) => ({id: String(100 + i), value})),
      }),
      field('customfield_2', 'Замовник', {schema: {type: 'user'}}),
      field('components', 'Components', {required: true, schema: {type: 'array', items: 'component'}}),
      field('customfield_3', 'Team', {required: true, schema: {type: 'option'}}),
      field('labels', 'Labels', {schema: {type: 'array', items: 'string'}}),
      field('priority', 'Priority', {required: true, schema: {type: 'priority'}, hasDefaultValue: true}),
    ];
    const bug = buildBugFields({
      ...base,
      meta,
      parent: parent({
        customfield_2: {name: 'masiuk', displayName: 'Масюк Альона'},
        components: [{id: '7', name: 'Mobile'}],
      }),
      issueType: subtask,
    });
    expect(bug.fields.customfield_1).toEqual({id: '103'});
    expect(bug.fields.customfield_2).toEqual({name: 'masiuk'});
    expect(bug.fields.components).toEqual([{id: '7'}]);
    expect(bug.fields.labels).toEqual(['accessibility']);
    expect(bug.fields.priority).toBeUndefined();
    // Team is required, the task has no value for it, and Jira has no default
    expect(bug.missing).toEqual(['Team']);
    // severity and customer are shown as inputs, filled in already
    expect(bug.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({name: 'Серйозність помилки', type: 'option', value: {id: '103'}, display: 'S4'}),
        expect.objectContaining({name: 'Замовник', type: 'user', value: {name: 'masiuk'}, display: 'Масюк Альона'}),
      ]),
    );
    expect(bug.filled.map((item) => item.field)).toEqual(['Parent', 'Labels', 'Components']);
  });

  it('offers severity, customer and empty required fields as inputs, and takes what is chosen', () => {
    const meta = [
      field('customfield_1', 'Серйозність помилки', {
        required: true,
        schema: {type: 'option'},
        allowedValues: ['S1', 'S4'].map((value, i) => ({id: String(i), value})),
      }),
      field('customfield_2', 'Замовник', {required: true, schema: {type: 'user'}}),
      field('customfield_3', 'Середовище', {required: true, schema: {type: 'string'}}),
      field('customfield_4', 'Epic', {required: true, schema: {type: 'any'}}),
    ];
    const before = buildBugFields({...base, meta, parent: parent(), issueType: subtask});
    expect(before.inputs.map((item) => [item.name, item.type, item.value ?? null])).toEqual([
      ['Серйозність помилки', 'option', {id: '1'}],
      ['Замовник', 'user', null],
      ['Середовище', 'text', null],
    ]);
    // a field of a kind the dialog cannot ask for stays listed as missing
    expect(before.missing).toEqual(['Замовник', 'Середовище', 'Epic']);

    const after = buildBugFields({
      ...base,
      meta,
      parent: parent(),
      issueType: subtask,
      overrides: {
        customfield_1: {id: '0'},
        customfield_2: {accountId: 'abc'},
        customfield_3: 'prod',
        summary: 'ignored: Vision fills it',
        customfield_99: 'ignored: not on the screen',
      },
    });
    expect(after.fields).toMatchObject({
      customfield_1: {id: '0'},
      customfield_2: {accountId: 'abc'},
      customfield_3: 'prod',
      summary: 'S',
    });
    expect(after.fields.customfield_99).toBeUndefined();
    expect(after.missing).toEqual(['Epic']);
  });

  it('sends only fields on the create screen', () => {
    const bug = buildBugFields({...base, meta: [field('summary', 'Summary')], parent: parent(), issueType: bugType});
    expect(bug.fields.labels).toBeUndefined();
    expect(bug.fields.description).toBeUndefined();
  });
});

describe('copyValue', () => {
  it('turns a task value into what the create call takes', () => {
    expect(copyValue(field('x', 'X', {schema: {type: 'option'}}), {id: 5, value: 'A'})).toEqual({id: '5'});
    expect(copyValue(field('x', 'X', {schema: {type: 'option-with-child'}}), {id: 5, child: {id: 6}})).toEqual({
      id: '5',
      child: {id: '6'},
    });
    expect(copyValue(field('x', 'X', {schema: {type: 'array', items: 'user'}}), [{name: 'a'}])).toEqual([{name: 'a'}]);
    expect(copyValue(field('x', 'X', {schema: {type: 'string'}}), 'text')).toBe('text');
    expect(copyValue(field('x', 'X', {schema: {type: 'array', items: 'option'}}), [])).toBeUndefined();
  });
});

describe('inspectorBugText', () => {
  const problem = {code: 'a11y-3f9c2a1b', component: 'PbButton', everyScreen: true};

  it('fills the template from the dialog and the session instead of a check name', () => {
    const text = inspectorBugText({
      violations: [{...violation, details: {element: 'Button', widthDp: 347, heightDp: 40}}],
      problem,
      block: 'Кредитна сила',
      screen: 'Деталі договору',
      device: 'iPhone 15 · iOS 17.0',
      app: 'ua.bank',
      locators: ['id: ua.bank:id/btn'],
      suggestedLabel: 'Надати дані',
    });
    expect(text.summary).toBe(
      '[A11y] Кредитна сила. Деталі договору: Touch target too small (Надати дані) [a11y-3f9c2a1b]',
    );
    expect(text.description).toContain('||ID проблеми (Vision)|a11y-3f9c2a1b|');
    expect(text.description).toContain('||Компонент|PbButton|');
    expect(text.description).toContain('||Застосунок|ua.bank|');
    expect(text.description).toContain('||Локатор|id: ua.bank:id/btn|');
    expect(text.description).toContain('||Рекомендована назва|"Надати дані"|');
    expect(text.description).toContain('* widthDp: 347');
    expect(text.description).not.toContain('* element:');
    expect(text.description).toContain('Один баг на всі екрани.');
    expect(text.description).toContain('labels = a11y-3f9c2a1b');
  });

  it('lists every element of a problem on several elements', () => {
    const text = inspectorBugText({
      violations: [violation, {...violation, id: 'b', label: 'Далі', message: 'Button "Далі" is 300 × 40 dp.'}],
      problem,
      block: 'Login',
      screen: null,
      device: '',
      app: '',
      locators: ['id: a', 'id: b'],
    });
    expect(text.summary.startsWith('[A11y] Login: ')).toBe(true);
    expect(text.description).toContain('Та сама проблема на 2 елементах одного компонента:');
    expect(text.description).toContain('||Локатори|id: a; id: b|');
    expect(text.description).toContain('||Пристрій|—|');
  });
});
