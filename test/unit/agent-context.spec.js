import {describe, expect, it} from 'vitest';

import {chip, promptBlocks, referenceBlock} from '../../app/common/shared/agent/context.js';

describe('the reference that goes with a message', () => {
  it('names what is picked with ids and short names, never the content', () => {
    const chips = [
      chip('tab', 'proxy', 'Проксі'),
      chip('request', 'req-77', 'POST /v2/transfers 422'),
      chip('log', '1042', `E Pay: ${'x'.repeat(200)}`),
      chip('unknown', 'x', 'y'),
    ];
    expect(chips[3]).toBeNull();
    expect(chips[2].label.length).toBeLessThanOrEqual(80);
    const block = referenceBlock(chips);
    expect(block.split('\n')).toEqual([
      '<station-context>',
      'Where the user is in the station now. Fetch details with the station tools only when you need them.',
      '- tab: Проксі (id: proxy)',
      '- request: POST /v2/transfers 422 (id: req-77)',
      `- log: ${chips[2].label} (id: 1042)`,
      '</station-context>',
    ]);
  });

  it('puts the reference first and the person’s words after it; nothing when nothing is picked', () => {
    expect(promptBlocks('чому?', [chip('app', 'ua.bank', 'ua.bank')])).toEqual([
      {type: 'text', text: expect.stringContaining('- app: ua.bank')},
      {type: 'text', text: 'чому?'},
    ]);
    expect(promptBlocks('привіт', [])).toEqual([{type: 'text', text: 'привіт'}]);
  });
});
