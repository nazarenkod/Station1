import {IconAdjustments, IconApps, IconDeviceMobile, IconPlayerPlay, IconServer} from '@tabler/icons-react';
import {Alert, Button, Checkbox} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';

import {activeDevice, isDeviceRunning, selectDevice} from '../../actions/Workstation.js';
import {backend} from '../../polyfills.js';
import {getRandomId} from '../../utils/other.js';
import {appsProblemText, appVersionLabel} from '../Workstation/AppPicker.jsx';
import {deviceSubtitle} from '../Workstation/DevicePicker.jsx';

import styles from './SessionBuilder.module.css';

const DEFAULT_PORT = 4723;
// devices a session cannot start on, whatever the capabilities say
const UNUSABLE = ['broken', 'offline', 'unauthorized', 'disconnected'];

const isIos = (device) => /ios/i.test(device?.platformName ?? '');

/**
 * Capabilities for the device and app picked in the title bar.
 */
export function quickCapabilities(device, app, {keepData}) {
  const caps = {...device.capabilities};
  if (app?.id) {
    caps[isIos(device) ? 'appium:bundleId' : 'appium:appPackage'] = app.id;
    // apps that launch through an activity alias (a switchable icon) open another activity than
    // the one Appium resolves, which it would wait for in vain: any activity of the app will do
    if (!isIos(device) && !caps['appium:appWaitActivity']) {
      caps['appium:appWaitActivity'] = '*';
    }
  }
  caps['appium:noReset'] = keepData;
  return caps;
}

const toCapList = (caps) =>
  Object.entries(caps).map(([name, value]) => ({
    id: getRandomId(),
    type: typeof value === 'boolean' ? 'boolean' : 'text',
    enabled: true,
    name,
    value,
  }));

/**
 * A session in one press: the device and app from the title bar, our own
 * Appium server (started if it is not running), capabilities written for you.
 */
const QuickStart = ({loadNewSession, applyLocalServer, onAdvanced}) => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const workstation = useSelector((state) => state.workstation);
  const {devices, app, appium, appsError} = workstation;
  const device = activeDevice(workstation);
  const [keepData, setKeepData] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const serverRunning = appium?.status === 'running';
  const usable = device && !UNUSABLE.includes(device.state);
  const running = devices.filter(isDeviceRunning);

  const start = async () => {
    setError(null);
    // Appium would only fail to find the app's activity or bundle: say what is wrong instead
    if (app?.installed === false) {
      setError(t('quickAppMissing', {app: app.id, device: device.name}));
      return;
    }
    try {
      let port = serverRunning ? appium.port : null;
      if (!port) {
        setBusy('server');
        const result = await backend.doctor.startServer({port: DEFAULT_PORT});
        if (result.status !== 'running') {
          const [reason, detail] = (result.error ?? 'failed').split(':');
          setError(
            t(`doctorServerError_${reason}`, {port: DEFAULT_PORT, detail, defaultValue: result.error ?? reason}),
          );
          return;
        }
        port = DEFAULT_PORT;
      }
      await applyLocalServer({hostname: '127.0.0.1', port, path: ''});
      setBusy('session');
      await loadNewSession(toCapList(quickCapabilities(device, app, {keepData})));
    } finally {
      setBusy(null);
    }
  };

  const rows = [
    {
      key: 'device',
      icon: IconDeviceMobile,
      label: t('quickDevice'),
      value: device ? device.name : t('quickNoDevice'),
      sub: !device ? t('quickNoDeviceHint') : appsError ? appsProblemText(appsError, t) : deviceSubtitle(device, t),
      tone: !device || !usable || appsError ? 'warn' : 'ok',
    },
    {
      key: 'app',
      icon: IconApps,
      label: t('quickApp'),
      value: app?.id ?? t('quickNoApp'),
      sub: app
        ? app.installed === false
          ? t('wsAppNotInstalled')
          : appVersionLabel(app) || t('quickAppLaunch')
        : t('quickNoAppHint'),
      mono: !!app,
      tone: app && app.installed === false ? 'warn' : 'ok',
    },
    {
      key: 'server',
      icon: IconServer,
      label: t('quickServer'),
      value: serverRunning ? `Appium :${appium.port}` : t('quickServerAuto'),
      sub: serverRunning ? t('quickServerRunning') : t('quickServerAutoHint', {port: DEFAULT_PORT}),
      tone: 'ok',
    },
  ];

  return (
    <section className={styles.quick} aria-labelledby="quick-title">
      <div className={styles.quickHead}>
        <div className={styles.quickText}>
          <h1 id="quick-title" className={styles.quickTitle}>
            {t('quickTitle')}
          </h1>
          <p className={styles.quickLead}>{t('quickLead')}</p>
        </div>
        <Button type="link" icon={<IconAdjustments size={16} />} onClick={onAdvanced}>
          {t('quickAdvanced')}
        </Button>
      </div>

      <ul className={styles.quickRows}>
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <li key={row.key} className={`${styles.quickRow} ${row.tone === 'warn' ? styles.quickRowWarn : ''}`}>
              <span className={styles.quickIcon} aria-hidden="true">
                <Icon size={18} stroke={1.6} />
              </span>
              <span className={styles.quickRowText}>
                <span className={styles.quickLabel}>{row.label}</span>
                <span className={`${styles.quickValue} ${row.mono ? 'vi-mono' : ''}`}>{row.value}</span>
                <span className={styles.quickSub}>{row.sub}</span>
              </span>
            </li>
          );
        })}
      </ul>

      {!device && running.length > 0 && (
        <div className={styles.quickDevices}>
          {running.slice(0, 4).map((candidate) => (
            <Button key={candidate.id} onClick={() => dispatch(selectDevice(candidate.id))}>
              {t('deskUseDevice', {device: candidate.name})}
            </Button>
          ))}
        </div>
      )}

      {error && <Alert type="error" showIcon title={error} />}

      <div className={styles.quickFoot}>
        <Checkbox checked={keepData} onChange={(e) => setKeepData(e.target.checked)}>
          {t('quickKeepData')}
        </Checkbox>
        <Button
          type="primary"
          size="large"
          icon={<IconPlayerPlay size={18} />}
          disabled={!usable}
          loading={!!busy}
          onClick={start}
        >
          {busy === 'server' ? t('quickStartingServer') : busy === 'session' ? t('quickStarting') : t('startSession')}
        </Button>
      </div>
    </section>
  );
};

export default QuickStart;
