import {IconAdjustments, IconApps, IconDeviceMobile, IconPlayerPlay, IconServer} from '@tabler/icons-react';
import {Alert, Button, Checkbox} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {activeDevice, isDeviceRunning, selectDevice} from '../../actions/Workstation.js';
import {DEFAULT_PORT, startQuickSession} from '../../lib/session/quick-session.js';
import {appsProblemText, appVersionLabel} from '../Workstation/app-labels.js';
import {deviceSubtitle} from '../Workstation/DevicePicker.jsx';

import styles from './SessionBuilder.module.css';

// the Performance tab starts sessions with the same code
export {endSessionsOnDevice, quickCapabilities} from '../../lib/session/quick-session.js';

// devices a session cannot start on, whatever the capabilities say
const UNUSABLE = ['broken', 'offline', 'unauthorized', 'disconnected'];

/**
 * A session in one press: the device and app from the title bar, our own
 * Appium server (started if it is not running), capabilities written for you.
 */
const QuickStart = ({loadNewSession, onAdvanced}) => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const workstation = useSelector((state) => state.workstation);
  const {devices, app, appium, appsError} = workstation;
  const device = activeDevice(workstation);
  const [keepData, setKeepData] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const serverRunning = appium?.status === 'running';
  const usable = device && !UNUSABLE.includes(device.state);
  const running = devices.filter(isDeviceRunning);

  const start = async () => {
    setError(null);
    try {
      const result = await startQuickSession({
        dispatch,
        device,
        app,
        appium,
        keepData,
        open: loadNewSession,
        onStage: setBusy,
      });
      if (result.error) {
        setError({text: t(result.error.key, result.error.params), settings: result.error.settings});
      }
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

      {error && (
        <Alert
          type="error"
          showIcon
          title={error.text ?? error}
          action={
            error.settings && (
              <Button size="small" onClick={() => navigate('/settings', {state: {section: 'devices'}})}>
                {t('quickOpenSettings')}
              </Button>
            )
          }
        />
      )}

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
