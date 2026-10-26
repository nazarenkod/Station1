import {DEVICE_KIND} from '../doctor/devices.js';
import {runTool} from '../doctor/exec.js';

const CA_ON_DEVICE = '/sdcard/Download/station1-ca.crt';

const isAndroid = (device) =>
  device.kind === DEVICE_KIND.ANDROID_DEVICE || device.kind === DEVICE_KIND.ANDROID_EMULATOR;

const step = (name, result) => ({
  name,
  ok: result.ok,
  error: result.ok ? null : (result.stderr || result.stdout).trim(),
});

const adb = (device, args, timeout = 15000) => runTool('adb', ['-s', device.id, ...args], {timeout});

/**
 * Sends the device's traffic to the proxy and hands it the certificate.
 *
 * Android: `adb reverse` makes the proxy reachable as 127.0.0.1 on the
 * device (USB or emulator alike), the global HTTP proxy points there, and the
 * certificate goes to Downloads for the person to install (Android does not
 * let apps add a CA by themselves). Apps trust it when their
 * network_security_config allows user certificates, which debug builds
 * usually do.
 *
 * iOS simulator: the certificate is trusted through simctl; the traffic goes
 * through the Mac's own proxy settings.
 */
export async function connectDevice(device, {port, caPath}) {
  if (isAndroid(device)) {
    const steps = [
      step('reverse', await adb(device, ['reverse', `tcp:${port}`, `tcp:${port}`])),
      step('proxy', await adb(device, ['shell', 'settings', 'put', 'global', 'http_proxy', `127.0.0.1:${port}`])),
      step('certificate', await adb(device, ['push', caPath, CA_ON_DEVICE], 30000)),
    ];
    return {ok: steps.every((s) => s.ok), steps, caOnDevice: CA_ON_DEVICE};
  }
  if (device.kind === DEVICE_KIND.IOS_SIMULATOR) {
    const steps = [
      step(
        'certificate',
        await runTool('xcrun', ['simctl', 'keychain', device.id, 'add-root-cert', caPath], {timeout: 30000}),
      ),
    ];
    return {ok: steps.every((s) => s.ok), steps, needsMacProxy: true};
  }
  // a real iPhone is set up by hand: Wi-Fi proxy and the certificate from vi.proxy
  return {ok: true, steps: [], manual: true};
}

export async function disconnectDevice(device, {port}) {
  if (!isAndroid(device)) {
    return {ok: true, steps: []};
  }
  const steps = [
    // ":0" is how Android spells "no proxy"; deleting the setting needs a reboot to apply
    step('proxy', await adb(device, ['shell', 'settings', 'put', 'global', 'http_proxy', ':0'])),
    step('reverse', await adb(device, ['reverse', '--remove', `tcp:${port}`])),
  ];
  return {ok: steps.every((s) => s.ok), steps};
}

/**
 * Whether the device points at the proxy right now.
 */
export async function deviceProxyState(device, {port}) {
  if (!isAndroid(device)) {
    return {known: false};
  }
  const result = await adb(device, ['shell', 'settings', 'get', 'global', 'http_proxy']);
  const value = result.ok ? result.stdout.trim() : '';
  return {
    known: result.ok,
    value,
    ours: value === `127.0.0.1:${port}`,
    other: !!value && value !== ':0' && value !== 'null' && value !== `127.0.0.1:${port}`,
  };
}

// ---- the Mac's proxy, which the iOS simulator uses

async function primaryService() {
  const route = await runTool('route', ['-n', 'get', 'default'], {timeout: 5000});
  const iface = /interface:\s*(\S+)/.exec(route.stdout)?.[1];
  const ports = await runTool('networksetup', ['-listallhardwareports'], {timeout: 5000});
  if (!iface || !ports.ok) {
    return null;
  }
  const blocks = ports.stdout.split(/\n\s*\n/);
  const block = blocks.find((b) => new RegExp(`Device:\\s*${iface}\\b`).test(b));
  return /Hardware Port:\s*(.+)/.exec(block ?? '')?.[1]?.trim() ?? null;
}

export function parseNetworksetupProxy(output) {
  const value = (key) => new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(output)?.[1]?.trim() ?? '';
  return {enabled: value('Enabled') === 'Yes', server: value('Server'), port: Number(value('Port')) || 0};
}

/**
 * Points the Mac's web proxies (HTTP and HTTPS) at ours, remembering what
 * was there to put it back.
 */
export async function enableMacProxy(port) {
  const service = await primaryService();
  if (!service) {
    return {ok: false, error: 'No active network service found'};
  }
  const [web, secure] = await Promise.all([
    runTool('networksetup', ['-getwebproxy', service]),
    runTool('networksetup', ['-getsecurewebproxy', service]),
  ]);
  const previous = {service, web: parseNetworksetupProxy(web.stdout), secure: parseNetworksetupProxy(secure.stdout)};
  const results = [
    await runTool('networksetup', ['-setwebproxy', service, '127.0.0.1', String(port)]),
    await runTool('networksetup', ['-setsecurewebproxy', service, '127.0.0.1', String(port)]),
  ];
  const failed = results.find((r) => !r.ok);
  return failed ? {ok: false, error: (failed.stderr || failed.stdout).trim(), previous} : {ok: true, previous};
}

export async function restoreMacProxy(previous) {
  if (!previous?.service) {
    return {ok: true};
  }
  const restore = async (kind, state) => {
    if (state.enabled && state.server) {
      return await runTool('networksetup', [`-set${kind}`, previous.service, state.server, String(state.port)]);
    }
    return await runTool('networksetup', [`-set${kind}state`, previous.service, 'off']);
  };
  const results = [await restore('webproxy', previous.web), await restore('securewebproxy', previous.secure)];
  const failed = results.find((r) => !r.ok);
  return failed ? {ok: false, error: (failed.stderr || failed.stdout).trim()} : {ok: true};
}
