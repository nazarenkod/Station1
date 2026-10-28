// Which Kiro session holds which conversation: one for each task of a
// profile, and one general for the profile. Kiro keeps the conversations
// themselves; the station keeps only this map.

export const GENERAL = '_general';

const MAX_PER_PROFILE = 200;

/** The key of a conversation: the task, or the profile's general one. */
export const conversationKey = (taskKey) => (taskKey ? String(taskKey) : GENERAL);

const profileOf = (all, profileId) => all?.[profileId] ?? {current: {}, list: []};

/** The session of the conversation that is current for a task (or none), or null. */
export function currentSession(all, profileId, taskKey) {
  return profileOf(all, profileId).current?.[conversationKey(taskKey)] ?? null;
}

/**
 * Records a new conversation and makes it current for its task.
 * @returns the whole map, changed
 */
export function addConversation(
  all,
  profileId,
  {sessionId, conversation, taskKey = null, title = null, now = new Date()},
) {
  const profile = profileOf(all, profileId);
  const key = conversationKey(taskKey);
  const entry = {
    sessionId,
    // the station's own id of the conversation: its tools' address, known before Kiro names the session
    conversation: conversation ?? sessionId,
    key,
    title,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
  const list = [entry, ...profile.list.filter((one) => one.sessionId !== sessionId)].slice(0, MAX_PER_PROFILE);
  return {...all, [profileId]: {current: {...profile.current, [key]: sessionId}, list}};
}

/** Makes an earlier conversation current again for its task. */
export function resumeConversation(all, profileId, sessionId) {
  const profile = profileOf(all, profileId);
  const entry = profile.list.find((one) => one.sessionId === sessionId);
  if (!entry) {
    return all;
  }
  return {...all, [profileId]: {...profile, current: {...profile.current, [entry.key]: sessionId}}};
}

/** A conversation got a title, a new turn, or the hands on or off. */
export function touchConversation(all, profileId, sessionId, {title, hands, now = new Date()} = {}) {
  const profile = profileOf(all, profileId);
  return {
    ...all,
    [profileId]: {
      ...profile,
      list: profile.list.map((one) =>
        one.sessionId === sessionId
          ? {
              ...one,
              title: title ?? one.title,
              hands: hands ?? one.hands ?? false,
              updatedAt: new Date(now).toISOString(),
            }
          : one,
      ),
    },
  };
}

/** The conversations of a profile, the latest first, for «Past conversations». */
export function pastConversations(all, profileId) {
  return [...profileOf(all, profileId).list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** A task forgotten: its conversations go from the map (Kiro still keeps them). */
export function forgetTask(all, profileId, taskKey) {
  const profile = profileOf(all, profileId);
  const key = conversationKey(taskKey);
  const {[key]: _dropped, ...current} = profile.current ?? {};
  return {...all, [profileId]: {current, list: profile.list.filter((one) => one.key !== key)}};
}

/** The entry of a session in the map, with its profile. */
export function findConversation(all, sessionId) {
  for (const [profileId, profile] of Object.entries(all ?? {})) {
    const entry = profile.list?.find((one) => one.sessionId === sessionId);
    if (entry) {
      return {profileId, ...entry};
    }
  }
  return null;
}
