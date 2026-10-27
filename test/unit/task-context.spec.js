import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {taskTools} from '../../app/common/node/agent/task-tools.js';
import {collectTaskContext} from '../../app/common/node/task/context.js';
import {createTaskStore} from '../../app/common/node/task/store.js';
import {taskForAgent} from '../../app/common/shared/task/for-agent.js';
import {impactChanges, impactStale, itemId, validateImpact} from '../../app/common/shared/task/impact.js';
import {inlineParts, wikiBlocks} from '../../app/common/shared/task/jira-wiki.js';
import {diffStats, findLinks, parseTaskKey, storageToText} from '../../app/common/shared/task/task-text.js';

const JIRA = 'https://acme.atlassian.net';
const GITLAB = 'https://git.acme.io';

describe('picking a task', () => {
  it('takes a key or a Jira link, in any case', () => {
    expect(parseTaskKey('PAY-123')).toBe('PAY-123');
    expect(parseTaskKey(' pay-123 ')).toBe('PAY-123');
    expect(parseTaskKey(`${JIRA}/browse/PAY-77?focusedCommentId=1`)).toBe('PAY-77');
    expect(parseTaskKey(`${JIRA}/jira/software/projects/PAY/boards/1?selectedIssue=PAY-9`)).toBe('PAY-9');
    expect(parseTaskKey('переказ за IBAN')).toBeNull();
  });
});

describe('links in the texts of a task', () => {
  it('finds merge requests of our GitLab and pages of our Confluence, each once', () => {
    const links = findLinks(
      [
        `MR: ${GITLAB}/mobile/bank-android/-/merge_requests/481, review please.`,
        `again ${GITLAB}/mobile/bank-android/-/merge_requests/481/diffs and ${GITLAB}/mobile/shared/ui/-/merge_requests/12`,
        `spec: ${JIRA}/wiki/spaces/PAY/pages/123456/Transfers+by+IBAN and https://other.atlassian.net/wiki/spaces/X/pages/9`,
        'https://figma.com/file/abc',
      ],
      {jira: JIRA, gitlab: GITLAB},
    );
    expect(links.mrs).toEqual([
      {
        url: `${GITLAB}/mobile/bank-android/-/merge_requests/481`,
        origin: GITLAB,
        project: 'mobile/bank-android',
        iid: 481,
        ours: true,
      },
      {
        url: `${GITLAB}/mobile/shared/ui/-/merge_requests/12`,
        origin: GITLAB,
        project: 'mobile/shared/ui',
        iid: 12,
        ours: true,
      },
    ]);
    expect(links.pages.map((page) => [page.id, page.ours])).toEqual([
      ['123456', true],
      ['9', false],
    ]);
    expect(links.other).toEqual(['https://figma.com/file/abc']);
  });

  it('turns a Confluence page into plain text and cuts it', () => {
    const {text, cut} = storageToText(
      '<h1>Переказ</h1><p>Поле <b>purpose</b> &amp; сума</p><ul><li>до 140</li></ul>',
      100,
    );
    expect(text).toBe('Переказ\nПоле purpose & сума\n- до 140');
    expect(cut).toBe(false);
    expect(storageToText('x'.repeat(50), 10)).toEqual({text: 'x'.repeat(10), cut: true});
  });

  it('counts the lines of a diff', () => {
    expect(diffStats('--- a/x\n+++ b/x\n@@\n-old\n+new\n+more\n same')).toEqual({additions: 2, deletions: 1});
  });
});

const issue = (key, fields = {}) => ({
  key,
  fields: {
    summary: `Summary of ${key}`,
    issuetype: {name: 'Task'},
    status: {name: 'In testing'},
    description: '',
    comment: {comments: []},
    issuelinks: [],
    subtasks: [],
    updated: '2026-10-27T09:00:00.000+0000',
    ...fields,
  },
});

const fakeJira = (issues, pages = {}) => ({
  site: JIRA,
  get: async (requestPath) => {
    const remote = /\/issue\/([^/?]+)\/remotelink/.exec(requestPath);
    if (remote) {
      return remote[1] === 'PAY-1' ? [{object: {url: `${JIRA}/wiki/spaces/PAY/pages/77/Spec`}}] : [];
    }
    const key = /\/issue\/([^/?]+)\?/.exec(requestPath)?.[1];
    if (key) {
      if (!issues[key]) {
        throw Object.assign(new Error('Issue does not exist'), {status: 404});
      }
      return issues[key];
    }
    const page = /\/content\/(\d+)/.exec(requestPath)?.[1];
    if (pages[page]) {
      return pages[page];
    }
    throw Object.assign(new Error('Forbidden'), {status: 403});
  },
});

const fakeGitlab = {
  site: GITLAB,
  request: async (requestPath) => {
    if (requestPath.endsWith('/merge_requests/481')) {
      return {
        title: 'Add purpose to transfers',
        state: 'opened',
        source_branch: 'feature/PAY-2',
        target_branch: 'develop',
        sha: 'abc123',
      };
    }
    if (requestPath.includes('/merge_requests/481/diffs')) {
      return [{new_path: 'app/src/TransferRequest.kt', diff: '@@\n+val purpose: String\n', new_file: false}];
    }
    throw Object.assign(new Error('GitLab answered: not found'), {status: 404});
  },
};

describe('a Jira description on the card', () => {
  it('turns links, bold, colours and underline into text and links', () => {
    const parts = inlineParts(
      'Екран ([+Стан 1.+|https://www.figma.com/design/Y9/Gamification?node-id=442] *Активний* {color:#f00}розіграш{color})',
    );
    expect(parts.map(({text, url, bold}) => [text, url ?? null, !!bold])).toEqual([
      ['Екран (', null, false],
      ['Стан 1.', 'https://www.figma.com/design/Y9/Gamification?node-id=442', false],
      [' ', null, false],
      ['Активний', null, true],
      [' розіграш)', null, false],
    ]);
    expect(inlineParts('див. https://git.acme.io/a/b/-/merge_requests/12')[1]).toMatchObject({
      text: 'git.acme.io/…/12',
    });
  });

  it('keeps headings, list items and code as blocks', () => {
    expect(
      wikiBlocks('h2. Критерії\n* перше\n** вкладене\n{code}val x = 1{code}\n----\nтекст').map((block) => [
        block.type,
        block.level ?? null,
      ]),
    ).toEqual([
      ['heading', 2],
      ['item', 1],
      ['item', 2],
      ['code', null],
      ['rule', null],
      ['text', null],
    ]);
  });
});

describe('gathering the context of a task', () => {
  const issues = {
    'PAY-1': issue('PAY-1', {
      issuetype: {name: 'Test'},
      description: 'Перевірити переказ з призначенням.',
      issuelinks: [
        {type: {outward: 'tests', inward: 'is tested by'}, outwardIssue: {key: 'PAY-2'}},
        {type: {outward: 'relates to'}, outwardIssue: {key: 'PAY-404'}},
      ],
      comment: {
        comments: [
          {
            author: {displayName: 'Dev'},
            created: '2026-10-26',
            body: `MR ${GITLAB}/mobile/bank-android/-/merge_requests/481`,
          },
        ],
      },
    }),
    'PAY-2': issue('PAY-2', {
      issuetype: {name: 'Story'},
      description: `Додати purpose. ${GITLAB}/mobile/bank-android/-/merge_requests/999`,
    }),
  };
  const pages = {
    77: {title: 'Перекази: вимоги', space: {key: 'PAY'}, body: {storage: {value: '<p>purpose до 140 символів</p>'}}},
  };

  it('brings the task, the linked development task, the pages and the merge requests', async () => {
    const result = await collectTaskContext({
      key: 'PAY-1',
      jira: fakeJira(issues, pages),
      gitlab: fakeGitlab,
      git: {log: async () => [{sha: 'f00ba4', subject: 'PAY-2 add purpose'}]},
    });
    expect(result.ok).toBe(true);
    const {context} = result;
    expect(context.url).toBe(`${JIRA}/browse/PAY-1`);
    expect(context.task).toMatchObject({key: 'PAY-1', type: 'Test', status: 'In testing'});
    expect(context.task.comments).toHaveLength(1);
    expect(context.linked).toEqual([expect.objectContaining({key: 'PAY-2', relation: 'tests', type: 'Story'})]);
    expect(context.pages).toEqual([
      expect.objectContaining({id: '77', title: 'Перекази: вимоги', text: 'purpose до 140 символів'}),
    ]);
    expect(context.mrs[0]).toMatchObject({
      iid: 481,
      sha: 'abc123',
      targetBranch: 'develop',
      files: [{path: 'app/src/TransferRequest.kt', additions: 1, deletions: 0, status: 'modified'}],
    });
    expect(context.mrs[1]).toMatchObject({iid: 999, skipped: 'failed'});
    expect(context.commits).toEqual([{sha: 'f00ba4', subject: 'PAY-2 add purpose'}]);
    // a source that failed leaves a note, the rest still comes
    expect(context.problems.map((one) => [one.source, one.error])).toEqual([
      ['linked:PAY-404', 'notFound'],
      [`mr:${GITLAB}/mobile/bank-android/-/merge_requests/999`, 'notFound'],
    ]);
  });

  it('says Jira is not set up, or that the task is not there', async () => {
    expect(await collectTaskContext({key: 'PAY-1', jira: null})).toEqual({ok: false, error: 'jiraNotSetUp'});
    expect(await collectTaskContext({key: 'NOPE-1', jira: fakeJira(issues)})).toMatchObject({
      ok: false,
      error: 'notFound',
    });
  });

  it('leaves merge requests as links when GitLab is not connected', async () => {
    const result = await collectTaskContext({key: 'PAY-1', jira: fakeJira(issues, pages), gitlab: null, git: null});
    expect(result.context.mrs[0]).toMatchObject({iid: 481, skipped: 'gitlabNotSetUp'});
  });
});

describe('the impact checklist', () => {
  const evidence = [{file: 'app/src/TransferRequest.kt', lines: '12-20'}];

  it('keeps checks with evidence and leaves out general advice, repeats and checks without evidence', () => {
    const {items, rejected, empty} = validateImpact({
      check: [
        {text: 'Переказ → POST /v2/transfers: є purpose', important: true, evidence},
        {text: 'Переказ: 422 → текст помилки з відповіді', evidence},
        {text: 'Переказ → POST /v2/transfers: є purpose', evidence},
        {text: 'Перевірте всі екрани застосунку', evidence},
        {text: 'Поле purpose обрізається', evidence: []},
      ],
      regress: [],
      empty: {regress: 'Нічого поза задачею зміна не зачіпає.'},
    });
    expect(items.map((item) => [item.section, item.text, item.important])).toEqual([
      ['check', 'Переказ → POST /v2/transfers: є purpose', true],
      ['check', 'Переказ: 422 → текст помилки з відповіді', false],
    ]);
    expect(rejected.map((one) => one.reason)).toEqual([
      'repeats another check',
      'general advice: say what exactly to check here',
      'no evidence: give a file and lines of the diff, a commit or a usage site',
    ]);
    expect(empty).toEqual({regress: 'Нічого поза задачею зміна не зачіпає.'});
  });

  it('has no cap on the number of checks', () => {
    const many = Array.from({length: 25}, (_, index) => ({text: `Екран ${index}: поле purpose`, evidence}));
    expect(validateImpact({check: many}).items).toHaveLength(25);
  });

  it('says what a re-run added and removed, and when the analysis is stale', () => {
    const before = [
      {id: itemId('check', 'a'), text: 'a', section: 'check'},
      {id: itemId('check', 'b'), text: 'b', section: 'check'},
    ];
    const after = [
      {id: itemId('check', 'b'), text: 'b'},
      {id: itemId('check', 'c'), text: 'c'},
    ];
    expect(impactChanges(before, after)).toEqual({
      added: [itemId('check', 'c')],
      removed: [{id: itemId('check', 'a'), text: 'a', section: 'check'}],
    });
    const impact = {at: '2026-10-27T10:00:00Z', mrVersions: [{url: 'mr1', sha: 'abc'}]};
    expect(impactStale(impact, {mrs: [{url: 'mr1', sha: 'abc'}], task: {updated: '2026-10-27T09:00:00Z'}})).toBe(false);
    expect(impactStale(impact, {mrs: [{url: 'mr1', sha: 'def'}], task: {}})).toBe(true);
    expect(
      impactStale(impact, {
        mrs: [
          {url: 'mr1', sha: 'abc'},
          {url: 'mr2', sha: 'x'},
        ],
        task: {},
      }),
    ).toBe(true);
    expect(impactStale(impact, {mrs: [], task: {updated: '2026-10-27T11:00:00Z'}})).toBe(true);
  });
});

describe('the tasks on this Mac', () => {
  let dir;
  let settings;
  let store;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'station-tasks-'));
    settings = new Map();
    store = createTaskStore({
      dir,
      get: async (key) => settings.get(key),
      set: async (key, value) => settings.set(key, value),
      settingKey: 'TASKS',
    });
  });
  afterEach(() => rm(dir, {recursive: true, force: true}));

  const context = {
    key: 'PAY-1',
    task: {key: 'PAY-1', summary: 'S', updated: null, comments: []},
    linked: [],
    pages: [],
    mrs: [{url: 'mr1', sha: 'abc', iid: 1, files: []}],
    commits: [],
    problems: [],
  };
  const check = (text) => ({text, evidence: [{file: 'a.kt'}]});

  it('keeps the task that is on and the recent ones per profile', async () => {
    await store.setCurrent('p1', 'PAY-1');
    await store.setCurrent('p1', 'PAY-2');
    await store.setCurrent('p2', 'OPS-1');
    expect(await store.tasks('p1')).toEqual({current: 'PAY-2', recent: ['PAY-2', 'PAY-1']});
    await store.forget('p1', 'PAY-2');
    expect(await store.tasks('p1')).toEqual({current: null, recent: ['PAY-1']});
  });

  it('keeps the ticks of checks that stayed after a re-run, and the credits of the turn that made it', async () => {
    await store.saveContext('p1', 'PAY-1', context);
    expect(
      await store.saveImpact('p1', 'PAY-1', {check: [check('a'), check('b')]}, {conversation: 'c1', turn: 2}),
    ).toMatchObject({ok: true, counts: {check: 2, regress: 0}});
    await store.check('p1', 'PAY-1', itemId('check', 'a'), true);
    await store.check('p1', 'PAY-1', itemId('check', 'b'), true);
    expect(await store.creditImpact('p1', 'PAY-1', {conversation: 'c1', turn: 2}, 1.25)).toBe(true);
    expect((await store.load('p1', 'PAY-1')).impact.credits).toBe(1.25);

    const again = await store.saveImpact(
      'p1',
      'PAY-1',
      {check: [check('a'), check('c')]},
      {conversation: 'c1', turn: 3},
    );
    expect(again.changes.added).toEqual([itemId('check', 'c')]);
    const data = await store.load('p1', 'PAY-1');
    expect(data.checks).toEqual({[itemId('check', 'a')]: true});
    expect(data.impact.stale).toBe(false);
  });

  it('marks the analysis stale when the merge request moved on', async () => {
    await store.saveContext('p1', 'PAY-1', context);
    await store.saveImpact('p1', 'PAY-1', {check: [check('a')]});
    await store.saveContext('p1', 'PAY-1', {...context, mrs: [{url: 'mr1', sha: 'new', iid: 1, files: []}]});
    expect((await store.load('p1', 'PAY-1')).impact.stale).toBe(true);
  });

  it('refuses an analysis for a task without context', async () => {
    expect(await store.saveImpact('p1', 'PAY-9', {check: [check('a')]})).toMatchObject({ok: false});
  });

  it('gives the agent an outline first and a part in full on demand', async () => {
    await store.setCurrent('p1', 'PAY-1');
    await store.saveContext('p1', 'PAY-1', context);
    const changed = [];
    const [contextTool, impactTool] = taskTools({
      current: async () => ({profileId: 'p1', key: 'PAY-1'}),
      store,
      turnOf: () => 4,
      onChanged: (change) => changed.push(change),
    });
    expect(contextTool.readOnly).toBe(true);
    expect(impactTool.autoAllow).toBe(true);
    const outline = await contextTool.run({}, {});
    expect(outline).toContain('Task PAY-1');
    expect(outline).toContain('Ask for a part');
    const saved = await impactTool.run(
      {check: [check('Переказ: purpose'), {text: 'без доказу', evidence: []}]},
      {conversation: 'c9'},
    );
    expect(saved).toContain('Saved for PAY-1: 1 checks, 0 regression risks.');
    expect(saved).toContain('"без доказу": no evidence');
    expect(changed).toEqual([{profileId: 'p1', key: 'PAY-1'}]);
    expect(taskForAgent({...context, impact: (await store.load('p1', 'PAY-1')).impact}, 'impact')).toContain(
      '- [check] Переказ: purpose',
    );
  });
});
