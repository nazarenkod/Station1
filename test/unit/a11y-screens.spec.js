import {describe, expect, it} from 'vitest';

import {
  recordScreen,
  screenHistory,
  stopViewing,
  viewScreen,
} from '../../app/common/renderer/components/A11yTool/screen-history.js';
import {signatureDistance} from '../../app/common/renderer/components/A11yTool/screen-signature.js';

const visit = (key, sessionId = 's1') =>
  recordScreen({
    sessionId,
    screen: {key, title: key, source: 'title-tag'},
    sourceXML: `<${key}/>`,
    screenshot: null,
    score: 90,
    counts: {error: 0, warning: 1, info: 0},
  });

describe('session screens', function () {
  it('counts a visit on each transition, not on checking the same screen again', async function () {
    await visit('login');
    await visit('login');
    await visit('home');
    await visit('login');
    const {screens, currentKey, transitions} = screenHistory();
    expect(screens.map((s) => [s.key, s.visits])).toEqual([
      ['login', 2],
      ['home', 1],
    ]);
    expect(currentKey).toBe('login');
    expect(transitions).toBe(2);
  });

  it('does not count a past screen shown again, and starts over with a new session', async function () {
    viewScreen('home');
    await visit('home');
    expect(screenHistory().screens.find((s) => s.key === 'home').visits).toBe(1);
    stopViewing();
    await visit('cards', 's2');
    expect(screenHistory().screens.map((s) => s.key)).toEqual(['cards']);
  });
});

describe('screen signatures', function () {
  it('tells another screen from the same one with a small change', function () {
    const a = new Float32Array(100).fill(0.5);
    const cursor = Float32Array.from(a, (v, i) => (i === 3 ? 1 : v));
    const other = new Float32Array(100).fill(0.9);
    expect(signatureDistance(a, cursor)).toBeLessThan(0.025);
    expect(signatureDistance(a, other)).toBeGreaterThan(0.025);
    expect(signatureDistance(a, null)).toBe(1);
  });
});
