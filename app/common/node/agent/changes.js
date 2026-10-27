import {isDeepStrictEqual} from 'node:util';

// Every change the agent makes to the station, with the value before and
// after, so it can be rolled back: one change, or everything of a turn. A
// change the person has changed again by hand is not rolled back without
// asking, since the rollback would wipe the person's work.

const MAX_CHANGES = 500;

/**
 * @param {object} options
 * @param {(key: string) => Promise<any>} options.get reads a setting
 * @param {(key: string, value: any) => Promise<void>} options.set writes it
 * @param {(keys: string[]) => void} options.onChanged the tools read these settings again
 */
export function createChangeJournal({get, set, onChanged}) {
  const entries = [];
  let nextId = 0;

  const record = (entry) => {
    entries.push({id: `c${++nextId}`, at: new Date().toISOString(), undone: false, ...entry});
    if (entries.length > MAX_CHANGES) {
      entries.splice(0, entries.length - MAX_CHANGES);
    }
    return entries.at(-1);
  };

  const revert = async (entry) => {
    if (entry.revert) {
      await entry.revert();
    } else {
      await set(entry.key, entry.before);
      onChanged([entry.key]);
    }
    entry.undone = true;
  };

  // whether the setting still holds what the agent left there
  const untouched = async (entry) =>
    entry.isCurrent ? await entry.isCurrent() : isDeepStrictEqual(await get(entry.key), entry.after);

  return {
    /**
     * Changes one setting with a function of its value.
     * @param {{conversation: string, turn: number, tool: string, key: string, fallback?: any, compute: (value: any) => {value?: any, summary?: string, error?: string}}} change
     */
    async apply({conversation, turn, tool, key, fallback = null, compute}) {
      const before = (await get(key)) ?? fallback;
      const result = compute(structuredClone(before));
      if (result.error) {
        return {error: result.error};
      }
      await set(key, result.value);
      onChanged([key]);
      return record({
        conversation,
        turn,
        tool,
        key,
        before,
        after: result.value,
        summary: result.summary ?? tool,
        extra: result,
      });
    },

    /** A change made elsewhere (a branch switch), with how to undo it. */
    note({conversation, turn, tool, summary, revert, isCurrent}) {
      return record({conversation, turn, tool, summary, revert, isCurrent});
    },

    /** @returns {Promise<{ok: true} | {conflict: true} | {error: string}>} */
    async undo(id, {force = false} = {}) {
      const entry = entries.find((one) => one.id === id);
      if (!entry || entry.undone) {
        return {error: 'gone'};
      }
      if (!force && !(await untouched(entry))) {
        return {conflict: true};
      }
      await revert(entry);
      return {ok: true};
    },

    /** Everything a turn changed, the last change first. */
    async undoTurn(conversation, turn, {force = false} = {}) {
      const ofTurn = entries.filter((one) => one.conversation === conversation && one.turn === turn && !one.undone);
      if (!force) {
        // each setting must still hold what the turn's last change to it left there
        const lastByKey = new Map(ofTurn.map((entry) => [entry.key ?? entry.id, entry]));
        for (const last of lastByKey.values()) {
          const later = entries
            .slice(entries.indexOf(last) + 1)
            .some((one) => !one.undone && one.key && one.key === last.key);
          if (later || !(await untouched(last))) {
            return {conflict: true};
          }
        }
      }
      for (const entry of ofTurn.reverse()) {
        await revert(entry);
      }
      return {ok: true, count: ofTurn.length};
    },

    /** The changes as the chat shows them: no values, no functions. */
    list(conversation) {
      return entries
        .filter((one) => !conversation || one.conversation === conversation)
        .map(({id, conversation: of, turn, tool, summary, at, undone}) => ({
          id,
          conversation: of,
          turn,
          tool,
          summary,
          at,
          undone,
        }));
    },
  };
}
