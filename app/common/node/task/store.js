import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {impactChanges, impactStale, validateImpact} from '../../shared/task/impact.js';

// The tasks of each profile on this Mac: which one is on, the ones used
// lately, and for each its context, impact analysis and ticks, in a file of
// the station's folder.

const RECENT = 10;

const safe = (text) => String(text).replace(/[^\w.-]/g, '_');

/**
 * @param {object} options
 * @param {string} options.dir the station's folder for tasks
 * @param {(key: string) => Promise<any>} options.get
 * @param {(key: string, value: any) => Promise<void>} options.set
 * @param {string} options.settingKey where the current and recent tasks are kept
 */
export function createTaskStore({dir, get, set, settingKey}) {
  const fileOf = (profileId, key) => path.join(dir, safe(profileId), `${safe(key)}.json`);
  const all = async () => (await get(settingKey)) ?? {};

  const load = async (profileId, key) => {
    try {
      const data = JSON.parse(await readFile(fileOf(profileId, key), 'utf8'));
      // whether the analysis still fits is worked out each time, from what the context says now
      if (data.impact && data.context) {
        data.impact.stale = impactStale(data.impact, data.context);
      }
      return data;
    } catch {
      return null;
    }
  };

  const save = async (profileId, key, data) => {
    await mkdir(path.dirname(fileOf(profileId, key)), {recursive: true});
    await writeFile(fileOf(profileId, key), JSON.stringify(data));
    return data;
  };

  const update = async (profileId, key, change) => {
    const data = (await load(profileId, key)) ?? {key, checks: {}, feedback: {}};
    return await save(profileId, key, change(data));
  };

  return {
    load,

    async tasks(profileId) {
      const mine = (await all())[profileId] ?? {};
      return {current: mine.current ?? null, recent: mine.recent ?? []};
    },

    /** The task the person works on now; it goes to the top of the recent ones. */
    async setCurrent(profileId, key) {
      const tasks = await all();
      const mine = tasks[profileId] ?? {};
      const recent = key
        ? [key, ...(mine.recent ?? []).filter((one) => one !== key)].slice(0, RECENT)
        : (mine.recent ?? []);
      await set(settingKey, {...tasks, [profileId]: {current: key ?? null, recent}});
      return {current: key ?? null, recent};
    },

    async saveContext(profileId, key, context) {
      return await update(profileId, key, (data) => ({...data, context}));
    },

    /**
     * Keeps an impact analysis: the checks that pass the rules, what changed
     * since the last one, the ticks of the checks that stayed.
     * @returns {Promise<{ok: true, kept: number, rejected: object[], counts: object, changes: object} | {ok: false, error: string}>}
     */
    async saveImpact(profileId, key, report, {conversation, turn} = {}) {
      const data = await load(profileId, key);
      if (!data?.context) {
        return {ok: false, error: 'The task has no context yet; the person loads it on the desk first.'};
      }
      const {items, empty, rejected} = validateImpact(report);
      const changes = impactChanges(data.impact?.items, items);
      const ids = new Set(items.map((item) => item.id));
      const impact = {
        at: new Date().toISOString(),
        items,
        empty,
        changes: data.impact ? changes : null,
        mrVersions: (data.context.mrs ?? []).filter((mr) => mr.sha).map((mr) => ({url: mr.url, sha: mr.sha})),
        conversation: conversation ?? null,
        turn: turn ?? null,
        credits: null,
      };
      await save(profileId, key, {
        ...data,
        impact,
        // a tick stays on a check that is still there
        checks: Object.fromEntries(Object.entries(data.checks ?? {}).filter(([id]) => ids.has(id))),
      });
      const counts = {check: 0, regress: 0};
      for (const item of items) {
        counts[item.section]++;
      }
      return {ok: true, kept: items.length, rejected, counts, changes};
    },

    /** The credits of the turn that made the analysis, once Kiro metered it. */
    async creditImpact(profileId, key, {conversation, turn}, credits) {
      const data = await load(profileId, key);
      if (data?.impact && data.impact.conversation === conversation && data.impact.turn === turn) {
        await save(profileId, key, {...data, impact: {...data.impact, credits}});
        return true;
      }
      return false;
    },

    /** The notes of the memory that belong to a task; they go when the task is forgotten. */
    async notes(profileId, key) {
      return (await load(profileId, key))?.notes ?? [];
    },

    async setNotes(profileId, key, notes) {
      return await update(profileId, key, (data) => ({...data, notes}));
    },

    async check(profileId, key, itemId, checked) {
      return await update(profileId, key, (data) => ({...data, checks: {...data.checks, [itemId]: !!checked}}));
    },

    async feedback(profileId, key, itemId, kind, reason = '') {
      return await update(profileId, key, (data) => ({
        ...data,
        feedback: {...data.feedback, [itemId]: {kind, reason, at: new Date().toISOString()}},
      }));
    },

    /** Forgets a task: its file, and its place among the recent ones. */
    async forget(profileId, key) {
      await rm(fileOf(profileId, key), {force: true});
      const tasks = await all();
      const mine = tasks[profileId] ?? {};
      await set(settingKey, {
        ...tasks,
        [profileId]: {
          current: mine.current === key ? null : (mine.current ?? null),
          recent: (mine.recent ?? []).filter((one) => one !== key),
        },
      });
    },
  };
}
