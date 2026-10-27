import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {createMemoryStore} from '../../app/common/node/agent/memory-store.js';
import {memoryTools} from '../../app/common/node/agent/memory-tools.js';
import {createTaskStore} from '../../app/common/node/task/store.js';
import {
  checkNote,
  cleanNote,
  mergeNotes,
  notesForAgent,
  pinnedNotes,
  searchNotes,
  similarNote,
  staleNotes,
} from '../../app/common/shared/agent/memory.js';
import {compileMasks} from '../../app/common/shared/agent/privacy.js';
import {AGENT_MEMORY, AGENT_PROJECT} from '../../app/common/shared/setting-defs.js';

describe('a note', () => {
  it('has a kind, a scope, a short text and tags', () => {
    const note = cleanNote({
      kind: 'nonsense',
      text: `  ${'x'.repeat(400)}  `,
      tags: {endpoint: 'POST /v2/transfers', bogus: 1},
    });
    expect(note).toMatchObject({
      kind: 'lesson',
      scope: 'project',
      pinned: false,
      uses: 0,
      tags: {endpoint: 'POST /v2/transfers'},
    });
    expect(note.text).toHaveLength(300);
    expect(note.id).toMatch(/^n-/);
  });

  it('is refused when it looks like a secret or holds personal data', () => {
    expect(checkNote('422 на /transfers при сумі 0 — не баг')).toEqual({ok: true});
    expect(checkNote('токен: glpat-abcdefghijklmnop')).toMatchObject({ok: false, reason: 'secret'});
    expect(checkNote('Authorization: Bearer eyJhbGciOi.eyJzdWIiOiIx')).toMatchObject({ok: false, reason: 'secret'});
    expect(checkNote('тестова картка 4149 4993 1234 5678', compileMasks())).toMatchObject({
      ok: false,
      reason: 'personal',
    });
    expect(checkNote('  ')).toMatchObject({ok: false, reason: 'empty'});
  });
});

describe('finding notes', () => {
  const notes = [
    cleanNote({
      id: 'a',
      kind: 'correction',
      text: '422 на /transfers при сумі 0 — очікувано, не баг',
      tags: {endpoint: 'POST /v2/transfers'},
      pinned: true,
    }),
    cleanNote({
      id: 'b',
      kind: 'lesson',
      text: 'На staging /limits повільний, відомо, PAY-88',
      tags: {endpoint: 'GET /v2/limits'},
    }),
    cleanNote({id: 'c', kind: 'preference', text: 'Звіт — коротко, списком', pinned: true}),
    cleanNote({id: 'd', kind: 'lesson', text: 'Екран Переказ шле POST /v2/transfers', tags: {screen: 'Переказ'}}),
  ];

  it('finds by the endpoint or screen first, then by words', () => {
    expect(searchNotes(notes, {tags: {endpoint: 'POST /v2/transfers 422'}}).map((note) => note.id)).toEqual(['a']);
    expect(searchNotes(notes, {tags: {screen: 'Переказ'}}).map((note) => note.id)).toEqual(['d']);
    expect(searchNotes(notes, {query: 'staging limits повільний'}).map((note) => note.id)).toEqual(['b']);
    expect(searchNotes(notes, {query: 'щось зовсім інше'})).toEqual([]);
  });

  it('sees a note that says nearly the same about the same things', () => {
    const again = cleanNote({
      text: '422 на /transfers при сумі 0 — не баг, очікувано',
      tags: {endpoint: 'POST /v2/transfers'},
    });
    expect(similarNote(again, notes)?.id).toBe('a');
    expect(similarNote(cleanNote({text: '422 на /transfers при сумі 0', tags: {}}), notes)).toBeNull();
  });

  it('pins within the budget, corrections first', () => {
    const long = Array.from({length: 7}, (_, index) =>
      cleanNote({id: `long-${index}`, text: 'y'.repeat(300), pinned: true}),
    );
    const {notes: kept, used, left} = pinnedNotes([...long, ...notes]);
    expect(kept[0].id).toBe('a');
    expect(used).toBeLessThanOrEqual(2000);
    expect(left).toBe(2);
  });

  it('finds notes nobody used for a long time, and adds notes from a file without repeats', () => {
    const now = new Date('2026-10-27T00:00:00Z');
    const old = cleanNote({id: 'old', text: 'old', createdAt: '2026-06-01T00:00:00Z'});
    const used = cleanNote({
      id: 'used',
      text: 'used',
      createdAt: '2026-06-01T00:00:00Z',
      lastUsedAt: '2026-10-20T00:00:00Z',
    });
    expect(staleNotes([old, used], now).map((note) => note.id)).toEqual(['old']);
    const merged = mergeNotes(notes, [
      {id: 'a', text: 'same id'},
      {text: 'Звіт коротко списком'},
      {text: 'Зовсім нова думка про шаблони'},
    ]);
    expect(merged).toHaveLength(5);
  });

  it('gives the agent one line a note with its id', () => {
    expect(notesForAgent([notes[0]])).toBe(
      '- a [correction, project; endpoint=POST /v2/transfers] 422 на /transfers при сумі 0 — очікувано, не баг',
    );
  });
});

describe('the memory on this Mac', () => {
  let dir;
  let settings;
  let tasks;
  let current;
  let memory;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'station-memory-'));
    settings = new Map([[AGENT_PROJECT, {instructions: 'x', mcpServers: [], notes: []}]]);
    const get = async (key) => settings.get(key);
    const set = async (key, value) => settings.set(key, value);
    tasks = createTaskStore({dir, get, set, settingKey: 'TASKS'});
    current = {profileId: 'p1', key: 'PAY-1'};
    memory = createMemoryStore({get, set, tasks, current: async () => current, masks: async () => compileMasks()});
  });
  afterEach(() => rm(dir, {recursive: true, force: true}));

  it('keeps each note in its scope: the person’s, the project’s, the task’s', async () => {
    await memory.save({kind: 'preference', scope: 'personal', text: 'Звіт коротко'});
    await memory.save({kind: 'correction', scope: 'project', text: '422 на /transfers при сумі 0 — не баг'});
    await memory.save({kind: 'lesson', scope: 'task', text: 'У цій задачі purpose до 140 символів'});
    expect(settings.get(AGENT_MEMORY).notes.map((note) => note.text)).toEqual(['Звіт коротко']);
    expect(settings.get(AGENT_PROJECT).notes.map((note) => note.text)).toEqual([
      '422 на /transfers при сумі 0 — не баг',
    ]);
    expect(settings.get(AGENT_PROJECT).instructions).toBe('x');
    expect((await tasks.notes('p1', 'PAY-1')).map((note) => note.text)).toEqual([
      'У цій задачі purpose до 140 символів',
    ]);
    expect((await memory.all()).map((note) => note.scope)).toEqual(['personal', 'project', 'task']);
    expect((await memory.all()).at(-1).tags.task).toBe('PAY-1');
  });

  it('refuses a secret, a task note without a task, and asks about a similar note', async () => {
    expect(await memory.save({text: 'пароль: hunter2', scope: 'project'})).toMatchObject({ok: false, reason: 'secret'});
    current = {profileId: 'p1', key: null};
    expect(await memory.save({text: 'про задачу', scope: 'task'})).toMatchObject({ok: false, reason: 'noTask'});
    const first = await memory.save({text: 'Шаблони переказів використовують TransferRequest', scope: 'project'});
    const similar = await memory.save({text: 'Шаблони переказів теж використовують TransferRequest', scope: 'project'});
    expect(similar).toMatchObject({ok: false, reason: 'similar', similar: {id: first.note.id}});
    const replaced = await memory.save(
      {text: 'Шаблони переказів теж використовують TransferRequest', scope: 'project'},
      {replace: first.note.id},
    );
    expect(replaced.ok).toBe(true);
    expect((await memory.all()).map((note) => note.text)).toEqual([
      'Шаблони переказів теж використовують TransferRequest',
    ]);
  });

  it('moves a note to another scope, pins it, counts its uses and cleans up the old ones', async () => {
    const {note} = await memory.save({text: 'Екран Переказ шле POST /v2/transfers', scope: 'project'});
    await memory.update(note.id, {scope: 'personal', pinned: true});
    expect(settings.get(AGENT_PROJECT).notes).toEqual([]);
    expect((await memory.pinned()).notes.map((one) => one.id)).toEqual([note.id]);
    await memory.markUsed([note.id]);
    expect((await memory.all())[0]).toMatchObject({uses: 1});
    expect(await memory.prune(-1)).toBe(1);
    expect(await memory.all()).toEqual([]);
  });

  it('lets the agent search and propose, never save', async () => {
    await memory.save({
      text: '422 на /transfers при сумі 0 — не баг',
      scope: 'project',
      tags: {endpoint: 'POST /v2/transfers'},
    });
    const used = [];
    const proposals = [];
    const [search, propose] = memoryTools({
      store: memory,
      masks: async () => compileMasks(),
      onUsed: (conversation, notes) => used.push([conversation, notes.length]),
      propose: (proposal) => proposals.push(proposal),
    });
    expect(search.readOnly).toBe(true);
    expect(propose.autoAllow).toBe(true);
    expect(await search.run({endpoint: 'POST /v2/transfers'}, {conversation: 'c1'})).toContain('422 на /transfers');
    expect(used).toEqual([['c1', 1]]);

    expect(
      await propose.run({kind: 'correction', text: 'токен: glpat-abcdefghijklmnop'}, {conversation: 'c1'}),
    ).toMatch(/looks like a secret/);
    const answer = await propose.run(
      {kind: 'correction', text: '422 на /transfers при сумі 0 — не баг, так задумано', endpoint: 'POST /v2/transfers'},
      {conversation: 'c1'},
    );
    expect(answer).toMatch(/kept only if they save it/);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].similar?.text).toBe('422 на /transfers при сумі 0 — не баг');
    expect(await memory.all()).toHaveLength(1);
  });
});
