import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';

import {describe, expect, it} from 'vitest';

import {KiroAgent} from '../../app/common/node/agent/kiro.js';

// a kiro-cli that answers initialize and session/new, or one that is not installed
function fakeSpawn(state) {
  return () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    if (!state.installed) {
      setTimeout(() => child.emit('error', Object.assign(new Error('spawn kiro-cli ENOENT'), {code: 'ENOENT'})), 0);
      return child;
    }
    child.stdin.on('data', (chunk) => {
      for (const line of String(chunk).split('\n').filter(Boolean)) {
        const message = JSON.parse(line);
        const result = message.method === 'session/new' ? {sessionId: 's-1', configOptions: []} : {protocolVersion: 1};
        child.stdout.write(`${JSON.stringify({jsonrpc: '2.0', id: message.id, result})}\n`);
      }
    });
    return child;
  };
}

describe('the Kiro process', () => {
  it('starts anew once Kiro is installed, after a start that failed', async () => {
    const state = {installed: false};
    const kiro = new KiroAgent({
      binary: async () => 'kiro-cli',
      env: async () => ({}),
      onPermission: async () => null,
      spawnProcess: fakeSpawn(state),
    });
    await expect(kiro.start()).rejects.toThrow('ENOENT');
    expect(kiro.running).toBe(false);
    state.installed = true;
    await expect(kiro.newSession({cwd: '/tmp'})).resolves.toMatchObject({sessionId: 's-1'});
  });
});
