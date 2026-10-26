import {IconCheck, IconFolder, IconPlugConnected, IconPlugConnectedX, IconX} from '@tabler/icons-react';
import {Alert, Button, Drawer, Popconfirm, Switch} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {backend} from '../../polyfills.js';

import styles from './Proxy.module.css';

const isAndroid = (device) => ['android-device', 'android-emulator'].includes(device?.kind);

const Steps = ({result}) => {
  const {t} = useTranslation();
  if (!result?.steps?.length) {
    return null;
  }
  return (
    <ul className={styles.steps}>
      {result.steps.map((step) => (
        <li key={step.name} className={step.ok ? styles.stepOk : styles.stepFail}>
          {step.ok ? <IconCheck size={14} /> : <IconX size={14} />}
          {t(`proxyStep_${step.name}`)}
          {step.error && <code className={styles.stepError}>{step.error}</code>}
        </li>
      ))}
    </ul>
  );
};

/**
 * Puts the active device on the proxy: the proxy setting, the certificate,
 * and for a real iPhone the steps to do by hand.
 */
const ConnectDrawer = ({open, onClose, device, status}) => {
  const {t} = useTranslation();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [deviceState, setDeviceState] = useState(null);
  const [macProxy, setMacProxy] = useState(false);
  const [macError, setMacError] = useState(null);

  useEffect(() => {
    if (!open || !device) {
      return;
    }
    setResult(null);
    backend.proxy.deviceState(device).then(setDeviceState);
    backend.proxy.macProxyState().then((s) => setMacProxy(s.enabled));
  }, [open, device]);

  const connect = async () => {
    setBusy(true);
    try {
      setResult(await backend.proxy.connectDevice(device));
      setDeviceState(await backend.proxy.deviceState(device));
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    try {
      setResult(await backend.proxy.disconnectDevice(device));
      setDeviceState(await backend.proxy.deviceState(device));
    } finally {
      setBusy(false);
    }
  };
  const toggleMac = async (enable) => {
    setMacError(null);
    const answer = await backend.proxy.macProxy(enable);
    setMacProxy(answer.enabled);
    if (!answer.ok) {
      setMacError(answer.error);
    }
  };

  const address = status.addresses?.[0]?.address ?? '…';

  return (
    <Drawer open={open} onClose={onClose} title={t('proxyConnectTitle')} size={520}>
      <div className={styles.connect}>
        <div className={styles.connectFacts}>
          <div>
            <span className={styles.label}>{t('proxyPort')}</span>
            <span className={styles.mono}>{status.port}</span>
          </div>
          <div>
            <span className={styles.label}>{t('proxyAddresses')}</span>
            <span className={styles.mono}>{(status.addresses ?? []).map((a) => a.address).join(', ') || '—'}</span>
          </div>
          <div>
            <span className={styles.label}>{t('proxyCaFingerprint')}</span>
            <span className={`${styles.mono} ${styles.fingerprint}`}>{status.ca?.fingerprint}</span>
          </div>
          <Button size="small" icon={<IconFolder size={14} />} onClick={() => backend.proxy.revealCa()}>
            {t('proxyRevealCa')}
          </Button>
        </div>

        {!device && <Alert type="info" showIcon title={t('proxyNoDevice')} />}

        {isAndroid(device) && (
          <section className={styles.connectBlock}>
            <h3 className={styles.connectTitle}>{device.name}</h3>
            <p className={styles.sub}>{t('proxyAndroidHow')}</p>
            {deviceState?.ours && <Alert type="success" showIcon title={t('proxyAndroidOn')} />}
            {deviceState?.other && (
              <Alert type="warning" showIcon title={t('proxyAndroidOther', {value: deviceState.value})} />
            )}
            <div className={styles.actions}>
              <Button type="primary" icon={<IconPlugConnected size={16} />} loading={busy} onClick={connect}>
                {t('proxyConnect')}
              </Button>
              {deviceState?.ours && (
                <Button icon={<IconPlugConnectedX size={16} />} loading={busy} onClick={disconnect}>
                  {t('proxyDisconnect')}
                </Button>
              )}
            </div>
            <Steps result={result} />
            {result?.ok && (
              <ol className={styles.howto}>
                <li>{t('proxyAndroidCa1')}</li>
                <li>{t('proxyAndroidCa2')}</li>
                <li>{t('proxyAndroidCa3')}</li>
              </ol>
            )}
            <Alert type="info" showIcon title={t('proxyAndroidTrustNote')} />
          </section>
        )}

        {device?.kind === 'ios-simulator' && (
          <section className={styles.connectBlock}>
            <h3 className={styles.connectTitle}>{device.name}</h3>
            <p className={styles.sub}>{t('proxySimHow')}</p>
            <div className={styles.actions}>
              <Button type="primary" icon={<IconPlugConnected size={16} />} loading={busy} onClick={connect}>
                {t('proxySimTrust')}
              </Button>
            </div>
            <Steps result={result} />
            <div className={styles.modeRow}>
              <span>{t('proxyMacProxy')}</span>
              {macProxy ? (
                <Switch checked onChange={() => toggleMac(false)} />
              ) : (
                <Popconfirm
                  title={t('proxyMacProxyConfirm')}
                  onConfirm={() => toggleMac(true)}
                  okText={t('proxyMacProxyOn')}
                >
                  <Switch checked={false} />
                </Popconfirm>
              )}
            </div>
            <span className={styles.sub}>{t('proxyMacProxyNote')}</span>
            {macError && <Alert type="error" showIcon title={macError} />}
          </section>
        )}

        {device?.kind === 'ios-device' && (
          <section className={styles.connectBlock}>
            <h3 className={styles.connectTitle}>{device.name}</h3>
            <ol className={styles.howto}>
              <li>{t('proxyIphone1', {address, port: status.port})}</li>
              <li>{t('proxyIphone2', {url: status.caUrl})}</li>
              <li>{t('proxyIphone3')}</li>
              <li>{t('proxyIphone4')}</li>
            </ol>
          </section>
        )}
      </div>
    </Drawer>
  );
};

export default ConnectDrawer;
