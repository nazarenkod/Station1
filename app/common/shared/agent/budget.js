// How much of the station's data the agent may read in a turn. Every
// character a tool gives back stays in the conversation and is paid for on
// every later turn, so each answer is capped, each turn has a budget, and
// a call that would give back what the agent already has says so instead.

export const DEFAULT_READ_BUDGET = 40000;
export const DEFAULT_DEEP_BUDGET = 200000;
export const DEFAULT_TOOL_LIMIT = 8000;

/** About how many tokens a text takes, for the person; four characters a token. */
export const approxTokens = (chars) => Math.ceil((chars || 0) / 4);

const stable = (value) =>
  JSON.stringify(value, (_key, inner) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.keys(inner)
            .sort()
            .map((key) => [key, inner[key]]),
        )
      : inner,
  );

// a short fingerprint; the same text gives the same one
function fingerprint(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index++) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
  }
  return `${text.length}:${hash}`;
}

/** A tool's answer as text, cut at the limit with a hint how to narrow it. */
export function capText(value, limit = DEFAULT_TOOL_LIMIT) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
  if (text.length <= limit) {
    return {text, truncated: false};
  }
  return {
    text: `${text.slice(0, limit)}\n… [cut at ${limit} of ${text.length} characters: narrow the call with fields, limit, a filter or an id]`,
    truncated: true,
  };
}

/**
 * The reading of one conversation: the budget of the turn that runs, and
 * what each call gave back before.
 */
export function createReadBudget({read = DEFAULT_READ_BUDGET, deep = DEFAULT_DEEP_BUDGET} = {}) {
  const budgets = {read, deep};
  const state = {turn: 0, limit: read, used: 0, deep: false, seen: new Map(), exhausted: false};
  return {
    /** A new turn: the budget starts again, larger for deep analysis. */
    startTurn({deep: isDeep = false, limits = {}} = {}) {
      // the settings may have changed the budgets since the last turn
      budgets.read = limits.read || budgets.read;
      budgets.deep = limits.deep || budgets.deep;
      state.turn++;
      state.deep = isDeep;
      state.limit = isDeep ? budgets.deep : budgets.read;
      state.used = 0;
      state.exhausted = false;
    },
    /** The person let the agent read more in this turn. */
    extend(by = budgets.read) {
      state.limit += by;
      state.exhausted = false;
    },
    /**
     * What a read tool gives back: its answer, the note that nothing changed,
     * or the note that the budget is used up.
     * @returns {{text: string, chars: number, kind: 'data' | 'same' | 'budget'}}
     */
    give(tool, args, value, {limit = DEFAULT_TOOL_LIMIT} = {}) {
      const capped = capText(value, limit);
      const key = `${tool} ${stable(args ?? {})}`;
      const print = fingerprint(capped.text);
      const before = state.seen.get(key);
      if (before && before.print === print) {
        const text = `Unchanged since turn ${before.turn}: the same result as before.`;
        return {text, chars: text.length, kind: 'same'};
      }
      if (state.used + capped.text.length > state.limit) {
        state.exhausted = true;
        const text = `The station read budget of this turn is used up (${state.used} of ${state.limit} characters). Answer with what you have, or tell the user what more you need and why; the user can allow more.`;
        return {text, chars: text.length, kind: 'budget'};
      }
      state.used += capped.text.length;
      state.seen.set(key, {print, turn: state.turn});
      return {text: capped.text, chars: capped.text.length, kind: 'data'};
    },
    state: () => ({
      turn: state.turn,
      limit: state.limit,
      used: state.used,
      deep: state.deep,
      exhausted: state.exhausted,
    }),
  };
}
