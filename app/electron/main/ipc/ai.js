import path from 'node:path';

import {app, ipcMain} from 'electron';
import settings from 'electron-settings';

import {AiService} from '../../../common/node/ai/service.js';
import {AI_CONFIG} from '../../../common/shared/setting-defs.js';
import {encryptedSecret} from '../secrets.js';

const key = encryptedSecret('AI_KEY_ENCRYPTED', 'key');

export function setupAiIPC() {
  const service = new AiService({
    getSettings: async () => (await settings.get(AI_CONFIG)) ?? {},
    getKey: key.read,
    cacheFile: path.join(app.getPath('userData'), 'ai-cache.json'),
  });

  ipcMain.handle('ai:status', async () => await service.status());
  ipcMain.handle('ai:hasKey', key.has);
  ipcMain.handle('ai:setKey', async (_evt, value) => await key.write(value));
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
