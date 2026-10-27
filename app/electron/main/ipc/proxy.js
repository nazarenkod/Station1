import {writeFile} from 'node:fs/promises';
import path from 'node:path';

import {app, BrowserWindow, dialog, ipcMain, shell} from 'electron';

import {
  connectDevice,
  deviceProxyState,
  disconnectDevice,
  enableMacProxy,
  restoreMacProxy,
} from '../../../common/node/proxy/device-setup.js';
import {toHar} from '../../../common/node/proxy/har.js';
import {ProxyServer} from '../../../common/node/proxy/server.js';

const broadcast = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
};

// headers a client computes itself; copying them over would break the request
const HOP_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'accept-encoding']);

/**
 * Sends a request again from here (not from the device), as edited by the
 * person, and records the answer next to the original.
 */
async function replay(proxy, request) {
  const started = Date.now();
  const headers = Object.fromEntries(
    Object.entries(request.headers ?? {}).filter(([name]) => !HOP_HEADERS.has(name.toLowerCase())),
  );
  const exchange = {
    id: `replay-${started}-${Math.random().toString(36).slice(2, 8)}`,
    method: request.method,
    url: request.url,
    protocol: request.url.split(':')[0],
    httpVersion: '1.1',
    startedAt: started,
    requestHeaders: headers,
    requestBody: request.body ?? '',
    requestSize: Buffer.byteLength(request.body ?? ''),
  };
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(60000),
    });
    const body = await response.text();
    return proxy.addReplay({
      ...exchange,
      status: response.status,
      statusMessage: response.statusText,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      responseBody: body,
      responseSize: Buffer.byteLength(body),
      durationMs: Date.now() - started,
      timings: null,
    });
  } catch (error) {
    return proxy.addReplay({
      ...exchange,
      status: 0,
      responseHeaders: {},
      responseBody: '',
      error: error.message,
      durationMs: Date.now() - started,
    });
  }
}

export function setupProxyIPC() {
  const proxy = new ProxyServer({
    dataDir: path.join(app.getPath('userData'), 'proxy'),
    onEvent: (event) => broadcast('proxy:batch', event),
  });
  // what this run changed outside the app, to put back on quit
  const connected = new Map();
  let macProxy = null;

  ipcMain.handle('proxy:start', async (_evt, options) => {
    try {
      return {ok: true, status: await proxy.start(options)};
    } catch (error) {
      return {ok: false, error: error.message};
    }
  });
  ipcMain.handle('proxy:stop', async () => {
    await proxy.stop();
    return proxy.status();
  });
  ipcMain.handle('proxy:snapshot', () => proxy.snapshot());
  ipcMain.handle('proxy:setMockRules', (_evt, rules) => proxy.setMockRules(rules));
  ipcMain.handle('proxy:setModes', (_evt, modes) => proxy.setModes(modes));
  ipcMain.handle('proxy:setTrafficRules', (_evt, rules) => proxy.setTrafficRules(rules));
  ipcMain.handle('proxy:clear', () => proxy.clear());
  ipcMain.handle('proxy:resume', (_evt, pauseId, decision) => proxy.resume(pauseId, decision));
  ipcMain.handle('proxy:replay', async (_evt, request) => await replay(proxy, request));
  ipcMain.handle('proxy:revealCa', () => proxy.ca && shell.showItemInFolder(proxy.ca.certPath));

  ipcMain.handle('proxy:exportHar', async (evt, ids, suggestedName) => {
    const all = proxy.snapshot().exchanges;
    const chosen = ids?.length ? all.filter((x) => ids.includes(x.id)) : all;
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(evt.sender), {
      defaultPath: suggestedName,
      filters: [{name: 'HAR', extensions: ['har']}],
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    await writeFile(result.filePath, JSON.stringify(toHar(chosen, app.getVersion()), null, 2));
    return result.filePath;
  });

  ipcMain.handle('proxy:connectDevice', async (_evt, device) => {
    if (!proxy.port) {
      return {ok: false, error: 'The proxy is not running'};
    }
    const result = await connectDevice(device, {port: proxy.port, caPath: proxy.ca.certPath});
    if (result.ok && !result.manual) {
      connected.set(device.id, device);
    }
    return result;
  });
  ipcMain.handle('proxy:disconnectDevice', async (_evt, device) => {
    connected.delete(device.id);
    return await disconnectDevice(device, {port: proxy.port ?? 0});
  });
  ipcMain.handle('proxy:deviceState', async (_evt, device) => await deviceProxyState(device, {port: proxy.port ?? 0}));

  ipcMain.handle('proxy:macProxy', async (_evt, enable) => {
    if (enable) {
      if (!proxy.port) {
        return {ok: false, error: 'The proxy is not running'};
      }
      const result = await enableMacProxy(proxy.port);
      macProxy = result.previous ?? null;
      return {ok: result.ok, error: result.error, enabled: result.ok};
    }
    const result = await restoreMacProxy(macProxy);
    if (result.ok) {
      macProxy = null;
    }
    return {...result, enabled: !result.ok};
  });
  ipcMain.handle('proxy:macProxyState', () => ({enabled: !!macProxy}));

  // a phone left pointing at a proxy that is gone has no internet: undo everything on quit
  let cleaned = false;
  app.on('before-quit', (event) => {
    if (cleaned || (!connected.size && !macProxy)) {
      return;
    }
    event.preventDefault();
    cleaned = true;
    Promise.allSettled([
      ...[...connected.values()].map((device) => disconnectDevice(device, {port: proxy.port ?? 0})),
      macProxy ? restoreMacProxy(macProxy) : null,
      proxy.stop(),
    ]).finally(() => app.quit());
  });

  // the agent reads the traffic from here
  return {snapshot: () => proxy.snapshot()};
}
