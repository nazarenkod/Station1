import path from 'node:path';

import {app, ipcMain, safeStorage} from 'electron';
import settings from 'electron-settings';

import {AiService} from '../../../common/node/ai/service.js';
import {AI_CONFIG} from '../../../common/shared/setting-defs.js';

// the Gemini key never reaches the renderer: it is stored encrypted by the OS keychain
const KEY_SETTING = 'AI_KEY_ENCRYPTED';

async function readKey() {
  const stored = await settings.get(KEY_SETTING);
  if (!stored) {
    return null;
  }
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  } catch {
    return null;
  }
}

export function setupAiIPC() {
  const service = new AiService({
    getSettings: async () => (await settings.get(AI_CONFIG)) ?? {},
    getKey: readKey,
    cacheFile: path.join(app.getPath('userData'), 'ai-cache.json'),
  });

  ipcMain.handle('ai:status', async () => await service.status());
  ipcMain.handle('ai:hasKey', async () => !!(await readKey()));
  ipcMain.handle('ai:setKey', async (_evt, key) => {
    if (!key) {
      await settings.unset(KEY_SETTING);
      return true;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('The system keychain is not available to keep the key safe');
    }
    await settings.set(KEY_SETTING, safeStorage.encryptString(key).toString('base64'));
    return true;
  });
  ipcMain.handle('ai:generate', async (_evt, request) => await service.generateJson(request));
  ipcMain.handle(
    'ai:test',
    async () =>
      await service.generateJson({
        kind: 'test',
        prompt: 'Reply with this JSON exactly: {"ok": true}',
        cacheParts: Date.now(),
      }),
  );
}
