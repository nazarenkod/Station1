import {useSyncExternalStore} from 'react';

// screenshots are large: the oldest screens go first past this many
const MAX_SCREENS = 40;
const THUMB_WIDTH = 96;

/**
 * The screens the session went through, in the order they were first seen:
 * each with a thumbnail, its score and problems, and what is needed to show
 * it again (its source and screenshot as last seen). Kept for the session
 * only, outside Redux, since the screenshots are large.
 */
let state = {
  sessionId: null,
  screens: [],
  // the screen on the device at the last check, and the one being looked back at
  currentKey: null,
  viewingKey: null,
  transitions: 0,
};
const listeners = new Set();

function publish(patch) {
  state = {...state, ...patch};
  for (const listener of listeners) {
    listener();
  }
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useScreenHistory = () => useSyncExternalStore(subscribe, () => state);
export const screenHistory = () => state;

/**
 * A small JPEG of the screenshot for the strip of screens.
 */
async function thumbnail(screenshot) {
  if (!screenshot) {
    return null;
  }
  try {
    const blob = await (await fetch(`data:image/png;base64,${screenshot}`)).blob();
    const image = await createImageBitmap(blob);
    const height = Math.round((image.height / image.width) * THUMB_WIDTH);
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_WIDTH;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, THUMB_WIDTH, height);
    image.close();
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}

/**
 * Notes the screen just checked. Another screen than the last one is a
 * transition and counts as a visit; the same screen checked again only
 * updates what is kept of it.
 */
export async function recordScreen({sessionId, screen, sourceXML, screenshot, score, counts}) {
  if (!sessionId || !screen?.key) {
    return;
  }
  // a new session starts a new history
  if (state.sessionId !== sessionId) {
    publish({sessionId, screens: [], currentKey: null, viewingKey: null, transitions: 0});
  }
  // a past screen shown again is not a visit
  if (state.viewingKey) {
    return;
  }
  const thumb = await thumbnail(screenshot);
  const now = Date.now();
  const arrived = state.currentKey !== screen.key;
  const existing = state.screens.find((entry) => entry.key === screen.key);
  const entry = {
    ...existing,
    key: screen.key,
    title: screen.title,
    source: screen.source,
    firstAt: existing?.firstAt ?? now,
    lastAt: now,
    visits: (existing?.visits ?? 0) + (arrived ? 1 : 0),
    thumb: thumb ?? existing?.thumb ?? null,
    sourceXML,
    screenshot,
    score,
    counts,
  };
  const screens = existing
    ? state.screens.map((item) => (item.key === screen.key ? entry : item))
    : [...state.screens, entry].slice(-MAX_SCREENS);
  publish({
    screens,
    currentKey: screen.key,
    transitions: state.transitions + (arrived && state.currentKey ? 1 : 0),
  });
}

export function viewScreen(key) {
  publish({viewingKey: key});
}

export function stopViewing() {
  publish({viewingKey: null});
}
