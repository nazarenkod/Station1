import {IconCircleCheck, IconInfoCircle, IconPlugConnected} from '@tabler/icons-react';
import {Button, Space, Tooltip} from 'antd';
import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {backend} from '../../polyfills.js';
import {notification} from '../../utils/notification.js';
import {startProxy, useProxy} from './proxy-store.js';

const isAndroid = (device) => ['android-device', 'android-emulator'].includes(device?.kind);
// what can be set up from this Mac; a real iPhone is set up by hand
const automatic = (device) => isAndroid(device) || device?.kind === 'ios-simulator';

/**
 * Whether the device is on the proxy now: Android by its proxy setting, a
 * simulator by the Mac's proxy, which is where its traffic goes.
 */
async function isSetUp(device) {
  if (isAndroid(device)) {
    return !!(await backend.proxy.deviceState(device))?.ours;
  }
  if (device?.kind === 'ios-simulator') {
    return !!(await backend.proxy.macProxyState())?.enabled;
  }
  return false;
}

/**
 * One press puts the selected device on the proxy, whatever it takes: the
 * proxy started, the device's proxy setting, the certificate, and for a
 * simulator the Mac's proxy. Pressed again it undoes it. A real iPhone
 * cannot be set up from the Mac: the press opens the steps to do by hand.
 * The details and the manual steps stay a click away in the drawer.
 */
const SetUpDevice = ({device, onOpenDetails, primary = true}) => {
  const {t} = useTranslation();
  const proxy = useProxy();
  const [busy, setBusy] = useState(false);
  const [setUp, setSetUp] = useState(false);

  const check = useCallback(async () => {
    setSetUp(device && proxy.started ? await isSetUp(device) : false);
  }, [device, proxy.started]);

  useEffect(() => {
    check();
  }, [check]);

  const failed = (steps) =>
    steps
      .filter((s) => !s.ok)
      .map((s) => `${t(`proxyStep_${s.name}`)}${s.error ? `: ${s.error}` : ''}`)
      .join('\n');

  const run = async () => {
    if (!device) {
      notification.info({title: t('proxySetUpNoDevice')});
      return;
    }
    if (!automatic(device)) {
      onOpenDetails();
      return;
    }
    setBusy(true);
    try {
      if (setUp) {
        if (isAndroid(device)) {
          await backend.proxy.disconnectDevice(device);
        } else {
          await backend.proxy.macProxy(false);
        }
        notification.success({title: t('proxySetUpUndone', {device: device.name}), duration: 3});
        return;
      }
      if (!proxy.started) {
        await startProxy();
      }
      const result = await backend.proxy.connectDevice(device);
      const steps = [...(result.steps ?? [])];
      if (result.ok && result.needsMacProxy) {
        const mac = await backend.proxy.macProxy(true);
        steps.push({name: 'macProxy', ok: mac.ok, error: mac.ok ? null : mac.error});
      }
      if (steps.every((s) => s.ok)) {
        notification.success({
          title: t('proxySetUpDone', {device: device.name}),
          description: isAndroid(device) ? t('proxySetUpDoneAndroid') : t('proxySetUpDoneSim'),
          duration: 8,
        });
      } else {
        notification.error({title: t('proxySetUpFailed', {device: device.name}), description: failed(steps)});
      }
    } finally {
      await check();
      setBusy(false);
    }
  };

  return (
    <Space.Compact>
      <Button
        type={primary && !setUp ? 'primary' : 'default'}
        icon={setUp ? <IconCircleCheck size={16} /> : <IconPlugConnected size={16} />}
        loading={busy}
        onClick={run}
      >
        {setUp ? t('proxySetUpUndo') : t('proxySetUp')}
      </Button>
      <Tooltip title={t('proxySetUpDetails')}>
        <Button icon={<IconInfoCircle size={16} />} aria-label={t('proxySetUpDetails')} onClick={onOpenDetails} />
      </Tooltip>
    </Space.Compact>
  );
};

export default SetUpDevice;
