import {
  IconAdjustments,
  IconApps,
  IconCheck,
  IconChevronDown,
  IconDeviceMobile,
  IconPlayerPlay,
  IconServer,
} from '@tabler/icons-react';
import {Alert, Button, Checkbox, Dropdown} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {platformKey, platformOfDevice} from '../../../shared/settings/platforms.js';
import {activeDevice, isDeviceRunning, noteSessionDevice, selectDevice} from '../../actions/Workstation.js';
import {DEFAULT_PORT, startQuickSession} from '../../lib/session/quick-session.js';
import {startProblemText, useStartProblems} from '../../lib/session/test-run.js';
import {useJoinSession} from '../../lib/session/use-join-session.js';
import {useProfiles} from '../../lib/settings/profiles-store.js';
import {appsProblemText, appVersionLabel} from '../Workstation/app-labels.js';
import {deviceSubtitle} from '../Workstation/DevicePicker.jsx';
import {AdviceActions} from '../Workstation/ProjectAdvice.jsx';

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
  // what «Start session» would stumble on, each on the row it is about
  const problems = useStartProblems();
  const {decide, joined} = useJoinSession();
  const profiles = useProfiles();

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
        decide,
        onStage: setBusy,
      });
      if (result.error) {
        setError({text: t(result.error.key, result.error.params), settings: result.error.settings});
      } else if (!result.refused) {
        joined(result);
        dispatch(noteSessionDevice(device.id));
      }
    } finally {
      setBusy(null);
    }
  };

  const profile = profiles.list?.find((one) => one.id === profiles.activeId);
  const notForProject = (candidate) => !!profile && !platformKey(profile, platformOfDevice(candidate));
  const deviceMenu = {
    items: running.map((candidate) => ({
      key: candidate.id,
      icon: candidate.id === device?.id ? <IconCheck size={14} /> : <span className={styles.quickMenuGap} />,
      label: (
        <span className={styles.quickMenuItem}>
          <span>{candidate.name}</span>
          <span className={styles.quickMenuSub}>
            {deviceSubtitle(candidate, t)}
            {notForProject(candidate) ? ` · ${t('wsDeviceNotForProject')}` : ''}
          </span>
        </span>
      ),
    })),
    onClick: ({key}) => dispatch(selectDevice(key)),
  };

  // the worst of a row's problems colours it; the first one says what to do
  const forRow = (target) => {
    const own = problems.filter((problem) => problem.target === target);
    const worst = own.find((problem) => problem.severity === 'error') ?? own[0] ?? null;
    return {problem: worst, tone: worst ? (worst.severity === 'error' ? 'error' : 'warn') : null};
  };
  const fixFor = (problem) => {
    if (!problem) {
      return null;
    }
    if (problem.key === 'noPlatform' || problem.key === 'noAppFor') {
      return <AdviceActions advice={problem.params} size="small" primary={false} />;
    }
    if (problem.key === 'appMissing') {
      return (
        <Button size="small" onClick={() => navigate('/builds')}>
          {t('quickToBuilds')}
        </Button>
      );
    }
    if (problem.target === 'station') {
      return (
        <Button size="small" onClick={() => navigate('/station')}>
          {t('wsStartFix_station')}
        </Button>
      );
    }
    return null;
  };

  const deviceRow = forRow('device');
  const appRow = forRow('app');
  const serverRow = forRow('station');
  const rows = [
    {
      key: 'device',
      icon: IconDeviceMobile,
      label: t('quickDevice'),
      value: device ? device.name : t('quickNoDevice'),
      sub: deviceRow.problem
        ? startProblemText(t, deviceRow.problem)
        : !device
          ? t('quickNoDeviceHint')
          : appsError
            ? appsProblemText(appsError, t)
            : deviceSubtitle(device, t),
      tone: deviceRow.tone ?? (!device || !usable || appsError ? 'warn' : 'ok'),
      action: running.length > 0 && (
        <Dropdown menu={deviceMenu} trigger={['click']} placement="bottomRight">
          <Button size="small">
            {device ? t('quickChangeDevice') : t('quickPickDevice')}
            <IconChevronDown size={14} />
          </Button>
        </Dropdown>
      ),
    },
    {
      key: 'app',
      icon: IconApps,
      label: t('quickApp'),
      value: app?.id ?? t('quickNoApp'),
      sub: appRow.problem
        ? startProblemText(t, appRow.problem)
        : app
          ? appVersionLabel(app) || t('quickAppLaunch')
          : t('quickNoAppHint'),
      mono: !!app,
      tone: appRow.tone ?? 'ok',
      action: fixFor(appRow.problem),
    },
    {
      key: 'server',
      icon: IconServer,
      label: t('quickServer'),
      value: serverRunning ? `Appium :${appium.port}` : t('quickServerAuto'),
      sub: serverRow.problem
        ? startProblemText(t, serverRow.problem)
        : serverRunning
          ? t('quickServerRunning')
          : t('quickServerAutoHint', {port: DEFAULT_PORT}),
      tone: serverRow.tone ?? 'ok',
      action: fixFor(serverRow.problem),
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
            <li
              key={row.key}
              className={`${styles.quickRow} ${row.tone === 'warn' ? styles.quickRowWarn : ''} ${row.tone === 'error' ? styles.quickRowError : ''}`}
            >
              <span className={styles.quickIcon} aria-hidden="true">
                <Icon size={18} stroke={1.6} />
              </span>
              <span className={styles.quickRowText}>
                <span className={styles.quickLabel}>{row.label}</span>
                <span className={`${styles.quickValue} ${row.mono ? 'vi-mono' : ''}`}>{row.value}</span>
                <span className={styles.quickSub}>{row.sub}</span>
              </span>
              {row.action && <span className={styles.quickRowAction}>{row.action}</span>}
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
