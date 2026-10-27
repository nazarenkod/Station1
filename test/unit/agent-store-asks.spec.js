import {describe, expect, it, vi} from 'vitest';

// the window's side of the operator: which conversation a «Fix with the operator» goes to
let sessions = 0;
const prompts = [];
const ok = () => ({ok: true, sessionId: `s${++sessions}`, conversation: 'c', model: 'Sonnet'});
const backend = {
  agent: {
    consented: vi.fn(async () => true),
    open: vi.fn(async () => ok()),
    newConversation: vi.fn(async () => ok()),
    turn: vi.fn(async () => 0),
    prompt: vi.fn(async ({sessionId, message}) => {
      prompts.push({sessionId, message});
      return {ok: true, stopReason: 'end_turn'};
    }),
    changes: vi.fn(async () => []),
  },
};
vi.mock('../../app/common/renderer/polyfills.js', () => ({backend}));
vi.mock('../../app/common/renderer/lib/settings/profiles-store.js', () => ({profilesState: () => ({activeId: 'p1'})}));
vi.mock('../../app/common/renderer/lib/task/task-store.js', () => ({currentTaskKey: () => null}));

const store = await import('../../app/common/renderer/lib/agent/agent-store.js');

describe('asks from the desk', () => {
  it('fixes each check in a conversation of its own, and the same check again in the same one', async () => {
    await store.askOnTask('fix node', {topic: 'fix:node'});
    await store.askOnTask('fix node again', {topic: 'fix:node'});
    await store.askOnTask('fix java', {topic: 'fix:java'});
    await store.askOnTask('what about the task?');
    const [node, again, java, plain] = prompts;
    expect(node.sessionId).toBe(again.sessionId);
    expect(java.sessionId).not.toBe(node.sessionId);
    // an ask with no topic stays in the conversation that is open
    expect(plain.sessionId).toBe(java.sessionId);
  });

  it('says a turn broke off when Kiro stopped it before the answer', async () => {
    backend.agent.prompt.mockResolvedValueOnce({ok: true, stopReason: 'max_turn_requests'});
    await store.sendMessage('go', []);
    expect(store.agentState().interrupted).toBe('max_turn_requests');
    await store.sendMessage('go', []);
    expect(store.agentState().interrupted).toBeNull();
  });
});
