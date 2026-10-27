import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {createCreditsStore} from '../../app/common/node/agent/credits-store.js';
import {
  appendLedger,
  formatCredits,
  ledgerEntry,
  MAX_LEDGER,
  needsConfirm,
  summarizeCredits,
} from '../../app/common/shared/agent/credits.js';

const now = new Date('2026-10-27T15:00:00Z');

describe('the credits ledger', () => {
  const ledger = [
    ledgerEntry({at: '2026-10-27T09:00:00Z', profileId: 'p1', taskKey: 'PAY-1', sessionId: 's1', credits: 0.5}),
    ledgerEntry({at: '2026-10-27T10:00:00Z', profileId: 'p1', taskKey: null, sessionId: 's2', credits: 0.25}),
    ledgerEntry({at: '2026-10-25T10:00:00Z', profileId: 'p2', taskKey: 'PAY-1', sessionId: 's3', credits: 1}),
    ledgerEntry({at: '2026-10-10T10:00:00Z', profileId: 'p1', taskKey: 'PAY-1', sessionId: 's1', credits: 2}),
    ledgerEntry({at: '2026-10-27T11:00:00Z', profileId: 'p1', sessionId: 's1', credits: undefined}),
  ];

  it('adds up today, the week, and by conversation, task and profile', () => {
    const sums = summarizeCredits(ledger, now);
    expect(sums.today).toBeCloseTo(0.75);
    expect(sums.week).toBeCloseTo(1.75);
    expect(sums.bySession.s1).toBeCloseTo(2.5);
    expect(sums.byTask['p1/PAY-1']).toBeCloseTo(2.5);
    expect(sums.byTask['p2/PAY-1']).toBeCloseTo(1);
    expect(sums.byProfile.p1).toBeCloseTo(2.75);
    expect(sums).toMatchObject({turns: 5, unmetered: 1});
  });

  it('keeps the last turns only', () => {
    const big = Array.from({length: MAX_LEDGER}, () => ledgerEntry({credits: 0.01}));
    const next = appendLedger(big, ledgerEntry({credits: 9}));
    expect(next).toHaveLength(MAX_LEDGER);
    expect(next.at(-1).credits).toBe(9);
  });

  it('asks once a day past the threshold, never without one', () => {
    expect(needsConfirm({spentToday: 5, limit: 0, confirmedDay: null, now})).toBe(false);
    expect(needsConfirm({spentToday: 4.9, limit: 5, confirmedDay: null, now})).toBe(false);
    expect(needsConfirm({spentToday: 5, limit: 5, confirmedDay: null, now})).toBe(true);
    expect(needsConfirm({spentToday: 7, limit: 5, confirmedDay: '2026-10-27', now})).toBe(false);
    expect(needsConfirm({spentToday: 7, limit: 5, confirmedDay: '2026-10-26', now})).toBe(true);
  });

  it('shows credits with two decimals, and a dash when unknown', () => {
    expect(formatCredits(0.0579, 'uk')).toBe('0,06');
    expect(formatCredits(1.5, 'en')).toBe('1.50');
    expect(formatCredits(null)).toBe('—');
  });
});

describe('the ledger file', () => {
  let dir;
  afterEach(() => rm(dir, {recursive: true, force: true}));

  it('keeps the turns between runs of the station', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'station-credits-'));
    const file = path.join(dir, 'agent', 'credits.json');
    await createCreditsStore(file).add({profileId: 'p1', sessionId: 's', credits: 0.2, at: new Date()});
    const again = createCreditsStore(file);
    await again.add({profileId: 'p1', sessionId: 's', credits: 0.3, at: new Date()});
    expect((await again.summary()).today).toBeCloseTo(0.5);
  });
});
