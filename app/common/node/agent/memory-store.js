import {checkNote, cleanNote, pinnedNotes, searchNotes, similarNote, staleNotes} from '../../shared/agent/memory.js';
import {AGENT_MEMORY, AGENT_PROJECT, DEFAULT_SETTINGS} from '../../shared/setting-defs.js';

// Where the notes live: the person's in a setting of this Mac, the project's
// with the profile (they travel with its export), a task's in the task's
// file. One list for the agent and the settings, each note knowing its scope.

/**
 * @param {object} deps
 * @param {(key: string) => Promise<any>} deps.get
 * @param {(key: string, value: any) => Promise<void>} deps.set
 * @param {ReturnType<import('../task/store.js').createTaskStore>} deps.tasks
 * @param {() => Promise<{profileId: string, key: string | null}>} deps.current the task that is on
 * @param {() => Promise<RegExp[]>} deps.masks
 */
export function createMemoryStore({get, set, tasks, current, masks}) {
  const personal = async () => ((await get(AGENT_MEMORY)) ?? DEFAULT_SETTINGS[AGENT_MEMORY]).notes ?? [];
  const project = async () => ({...DEFAULT_SETTINGS[AGENT_PROJECT], ...((await get(AGENT_PROJECT)) ?? {})});

  const read = async () => {
    const {profileId, key} = await current();
    return {
      personal: (await personal()).map((note) => ({...note, scope: 'personal'})),
      project: ((await project()).notes ?? []).map((note) => ({...note, scope: 'project'})),
      task: key
        ? (await tasks.notes(profileId, key)).map((note) => ({...note, scope: 'task', tags: {...note.tags, task: key}}))
        : [],
      profileId,
      key,
    };
  };

  const write = async (scope, notes, place) => {
    if (scope === 'personal') {
      await set(AGENT_MEMORY, {notes});
    } else if (scope === 'project') {
      await set(AGENT_PROJECT, {...(await project()), notes});
    } else if (place.key) {
      await tasks.setNotes(place.profileId, place.key, notes);
    }
  };

  const all = async () => {
    const scopes = await read();
    return [...scopes.personal, ...scopes.project, ...scopes.task];
  };

  const remove = async (id) => {
    const scopes = await read();
    for (const scope of ['personal', 'project', 'task']) {
      if (scopes[scope].some((note) => note.id === id)) {
        await write(
          scope,
          scopes[scope].filter((note) => note.id !== id),
          scopes,
        );
        return true;
      }
    }
    return false;
  };

  return {
    all,

    /**
     * Keeps a note the person accepted. A note like a secret is refused; one
     * like a kept note is refused too unless it replaces it or both are wanted.
     */
    async save(raw, {replace = null, keepBoth = false} = {}) {
      const note = cleanNote(raw);
      const checked = checkNote(note.text, await masks());
      if (!checked.ok) {
        return checked;
      }
      const scopes = await read();
      if (note.scope === 'task' && !scopes.key) {
        return {ok: false, reason: 'noTask'};
      }
      const others = (await all()).filter((one) => one.id !== replace && one.id !== note.id);
      const similar = keepBoth ? null : similarNote(note, others);
      if (similar) {
        return {ok: false, reason: 'similar', similar};
      }
      if (replace) {
        await remove(replace);
      }
      await remove(note.id);
      const fresh = await read();
      await write(note.scope, [...fresh[note.scope].map(({scope: _scope, ...one}) => one), note], fresh);
      return {ok: true, note};
    },

    async update(id, patch) {
      const note = (await all()).find((one) => one.id === id);
      if (!note) {
        return {ok: false, reason: 'gone'};
      }
      return await this.save({...note, ...patch, id}, {keepBoth: true});
    },

    remove,

    /** The notes the agent read, to see which help and which nobody needs. */
    async markUsed(ids) {
      const scopes = await read();
      const now = new Date().toISOString();
      for (const scope of ['personal', 'project', 'task']) {
        if (scopes[scope].some((note) => ids.includes(note.id))) {
          await write(
            scope,
            scopes[scope].map(({scope: _scope, ...note}) =>
              ids.includes(note.id) ? {...note, uses: (note.uses ?? 0) + 1, lastUsedAt: now} : note,
            ),
            scopes,
          );
        }
      }
    },

    async search(query, tags) {
      return searchNotes(await all(), {query, tags});
    },

    async pinned() {
      return pinnedNotes(await all());
    },

    async prune(days) {
      const stale = staleNotes(await all(), new Date(), days);
      for (const note of stale) {
        await remove(note.id);
      }
      return stale.length;
    },
  };
}
