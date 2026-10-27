import {describe, expect, it} from 'vitest';

import {DEFAULT_MODEL, modelName, pickModel} from '../../app/common/shared/agent/model.js';

const OFFERED = ['auto', 'claude-sonnet-4.5', 'claude-haiku-4.5', 'claude-sonnet-4', 'deepseek-3.2'];

describe('the model of the dispatcher', () => {
  it('pins the wanted model when Kiro offers it', () => {
    expect(pickModel([...OFFERED, 'claude-sonnet-5.5'], DEFAULT_MODEL)).toBe('claude-sonnet-5.5');
  });

  it('takes the newest of the same family when the wanted one is not offered', () => {
    expect(pickModel(OFFERED, 'claude-sonnet-5.5')).toBe('claude-sonnet-4.5');
  });

  it('leaves the choice to Kiro when nothing of the family is there', () => {
    expect(pickModel(['auto', 'glm-5'], 'claude-sonnet-5.5')).toBeNull();
    expect(pickModel([], 'claude-sonnet-5.5')).toBeNull();
  });

  it('names the model by Kiro’s list', () => {
    const option = {
      id: 'model',
      currentValue: 'claude-sonnet-4.5',
      options: [{value: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5'}],
    };
    expect(modelName(option)).toBe('Claude Sonnet 4.5');
    expect(modelName(null)).toBeNull();
  });
});
