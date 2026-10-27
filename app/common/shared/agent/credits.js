// The credits the agent spent, kept on this Mac turn by turn, and what the
// settings and the chat show of them: today, this week, by task and by
// profile, and whether the daily threshold is passed.

export const MAX_LEDGER = 20000;

const day = (date) => new Date(date).toISOString().slice(0, 10);

/**
 * A turn in the ledger. Turns without metering are kept too, with null
 * credits, so the count of turns stays honest.
 */
export function ledgerEntry({at = new Date(), profileId, taskKey = null, sessionId, credits, ms = null}) {
  return {
    at: new Date(at).toISOString(),
    profileId: profileId ?? null,
    taskKey: taskKey ?? null,
    sessionId: sessionId ?? null,
    credits: typeof credits === 'number' && Number.isFinite(credits) ? credits : null,
    ms,
  };
}

/** The ledger with one more turn, the oldest dropped past the limit. */
export function appendLedger(ledger, entry) {
  const next = [...(ledger ?? []), entry];
  return next.length > MAX_LEDGER ? next.slice(next.length - MAX_LEDGER) : next;
}

const add = (map, key, credits) => {
  if (key) {
    map[key] = (map[key] ?? 0) + credits;
  }
};

/**
 * The sums the person sees.
 * @returns {{today: number, week: number, bySession: object, byTask: object, byProfile: object, turns: number, unmetered: number}}
 */
export function summarizeCredits(ledger, now = new Date()) {
  const today = day(now);
  const weekStart = new Date(now).getTime() - 7 * 24 * 3600 * 1000;
  const result = {today: 0, week: 0, bySession: {}, byTask: {}, byProfile: {}, turns: 0, unmetered: 0};
  for (const entry of ledger ?? []) {
    result.turns++;
    if (entry.credits === null) {
      result.unmetered++;
      continue;
    }
    if (day(entry.at) === today) {
      result.today += entry.credits;
    }
    if (new Date(entry.at).getTime() >= weekStart) {
      result.week += entry.credits;
    }
    add(result.bySession, entry.sessionId, entry.credits);
    add(result.byProfile, entry.profileId, entry.credits);
    add(result.byTask, entry.profileId && entry.taskKey ? `${entry.profileId}/${entry.taskKey}` : null, entry.credits);
  }
  return result;
}

/**
 * Whether the next turn needs a yes: the daily threshold is passed and the
 * person has not said yes today. No threshold, no question.
 */
export function needsConfirm({spentToday, limit, confirmedDay, now = new Date()}) {
  if (!limit || limit <= 0) {
    return false;
  }
  return spentToday >= limit && confirmedDay !== day(now);
}

/** Credits as the person reads them: two decimals, a comma in Ukrainian. */
export function formatCredits(credits, language = 'uk') {
  if (credits === null || credits === undefined) {
    return '—';
  }
  return credits.toLocaleString(language === 'uk' ? 'uk-UA' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export const todayOf = day;
