import {describe, expect, it} from 'vitest';

import {composeSteering, DEFAULT_STATION_INSTRUCTIONS} from '../../app/common/shared/agent/instructions.js';
import {AGENT_CONFIG, AGENT_PROJECT} from '../../app/common/shared/setting-defs.js';
import {GROUPS, PROFILE_GROUPS, STATION_GROUPS} from '../../app/common/shared/settings/groups.js';

describe('the agent’s instructions', () => {
  it('are the station’s defaults, then the project’s, then the person’s, then pinned notes', () => {
    const text = composeSteering({
      station: null,
      project: 'Банківський застосунок, тестовий акаунт qa-1.',
      personal: 'Пиши коротко.',
      pinned: ['422 на /transfers при сумі 0 — не баг'],
    });
    expect(text.startsWith('---\ninclusion: always\n---\n')).toBe(true);
    expect(text).toContain(DEFAULT_STATION_INSTRUCTIONS.trim());
    const order = [
      '# You are the brain',
      '# About this project',
      '# The engineer’s own instructions',
      '# Pinned notes from memory',
    ].map((heading) => text.indexOf(heading));
    expect(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1]))).toBe(true);
  });

  it('take the station’s own text in place of the defaults, and skip empty layers', () => {
    const text = composeSteering({station: '# Мої правила', project: '  ', personal: ''});
    expect(text).toContain('# Мої правила');
    expect(text).not.toContain('You are the brain');
    expect(text).not.toContain('About this project');
  });

  it('tell the agent the rules of money, git and changes', () => {
    for (const rule of [
      'Context is money',
      'repo_checkout',
      'never edit, create or delete files',
      'memory_search',
      'impact_report',
      'goal_propose',
    ]) {
      expect(DEFAULT_STATION_INSTRUCTIONS).toContain(rule);
    }
  });
});

describe('the agent’s settings in profiles and exports', () => {
  it('keeps the project’s instructions and servers with the profile, the rest with the station', () => {
    expect(PROFILE_GROUPS).toContain('agent');
    expect(STATION_GROUPS).toContain('agentStation');
    const all = {
      [AGENT_PROJECT]: {
        instructions: 'Про застосунок',
        mcpServers: [
          {
            id: 'm1',
            name: 'jira',
            kind: 'http',
            url: 'https://x',
            headers: [{name: 'Authorization', value: '', hidden: true}],
          },
        ],
      },
      [AGENT_CONFIG]: {personalInstructions: 'коротко', mcpServers: [], readBudget: 30000, apiKey: 'leaked'},
    };
    const project = GROUPS.agent.read(all);
    expect(project.mcpServers[0].headers[0]).toEqual({name: 'Authorization', value: '', hidden: true});
    expect(GROUPS.agentStation.read(all)).not.toHaveProperty('apiKey');
    expect(GROUPS.agent.write(project)[AGENT_PROJECT].instructions).toBe('Про застосунок');
  });
});
