import {IconAlertTriangle, IconCircleCheck, IconCircleX, IconRefresh, IconStethoscope} from '@tabler/icons-react';
import {Button, Skeleton} from 'antd';
import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {activeDevice, ensureAppium, isDeviceRunning} from '../../actions/Workstation.js';
import {backend} from '../../polyfills.js';
import {useLogs} from '../Logs/logs-store.js';
import {useProxy} from '../Proxy/proxy-store.js';

import styles from './Desk.module.css';

// the environment check runs shell commands: once per app run, again on request
let cachedReport = null;

const STATUS_ICON = {
  ok: IconCircleCheck,
  warn: IconAlertTriangle,
  error: IconCircleX,
};

// the short name of each check of the doctor, for its tile
const CHECK_NAME = {
  node: 'node',
  appium: 'appium',
  appiumMissing: 'appium',
  driver: 'driver',
  androidSdk: 'androidSdk',
  androidSdkMissing: 'androidSdk',
  androidHome: 'androidSdk',
  adb: 'adb',
  java: 'java',
  xcode: 'xcode',
};

/**
 * Whether this machine is ready for work: what the doctor finds about the
 * environment, plus the server, the device, the proxy and the log right now.
 */
const DoctorPanel = () => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const workstation = useSelector((state) => state.workstation);
  const proxy = useProxy();
  const logs = useLogs();
  const [report, setReport] = useState(cachedReport);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(null);

  const load = useCallback(async () => {
    if (!backend.doctor) {
      return;
    }
    setLoading(true);
    try {
      cachedReport = await backend.doctor.environment();
      setReport(cachedReport);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!cachedReport) {
      load();
    }
  }, [load]);

  if (!backend.doctor) {
    return null;
  }

  const installDriver = async (driver) => {
    setFixing(driver);
    try {
      await backend.doctor.installDriver(driver);
      await load();
    } finally {
      setFixing(null);
    }
  };

  const device = activeDevice(workstation);
  const appium = workstation.appium;
  const tiles = [
    ...(report?.checks ?? []).map((check, i) => ({
      key: `${check.id}-${check.params?.driver ?? i}`,
      name: t(`deskCheck_${CHECK_NAME[check.id] ?? check.id}`, check.params),
      value: check.params?.version || t(`deskCheckValue_${check.status}`),
      status: check.status,
      text: t(`doctorCheck_${check.id}_${check.status}`, check.params),
      check,
    })),
    {
      key: 'server',
      name: t('deskCheck_server'),
      value:
        appium?.status === 'running'
          ? `:${appium.port}`
          : appium?.status === 'starting' || appium?.status === 'installing'
            ? t('deskCheckValue_starting')
            : t('deskCheckValue_stopped'),
      // starting on its own is not a problem; stopped or failed is, with a button to fix it
      status:
        appium?.status === 'running' || appium?.status === 'starting'
          ? 'ok'
          : appium?.status === 'failed'
            ? 'error'
            : 'warn',
      text: appium?.error
        ? t(`doctorServerError_${appium.error.split(':')[0]}`, {
            port: 4723,
            detail: appium.error.split(':')[1],
            defaultValue: appium.error,
          })
        : t('deskCheckServerOff'),
      fix: 'startAppium',
    },
    {
      key: 'device',
      name: t('deskCheck_device'),
      value: device?.name ?? t('deskCheckValue_none'),
      status: isDeviceRunning(device) ? 'ok' : 'warn',
      text: t('deskCheckDeviceOff'),
    },
    {
      key: 'proxy',
      name: t('deskCheck_proxy'),
      value: proxy.status.running ? `:${proxy.status.port}` : t('deskCheckValue_stopped'),
      status: proxy.status.running ? 'ok' : 'off',
    },
    {
      key: 'logs',
      name: t('deskCheck_logs'),
      value: logs.started ? t('deskCheckValue_recording') : t('deskCheckValue_stopped'),
      status: logs.started ? 'ok' : 'off',
    },
  ];
  // the proxy and the log are off until someone needs them: not a problem
  const problems = tiles.filter((tile) => tile.status === 'warn' || tile.status === 'error');

  return (
    <section className={`vi-panel ${styles.doctor}`} aria-labelledby="desk-doctor">
      <div className={styles.doctorHead}>
        <span className={styles.doctorIcon} aria-hidden="true">
          <IconStethoscope size={18} stroke={1.7} />
        </span>
        <h2 id="desk-doctor" className={styles.cardTitle}>
          {t('deskDoctor')}
        </h2>
        {report &&
          (problems.length ? (
            <span className="vi-pill vi-tone-warn">{t('deskDoctorIssues', {count: problems.length})}</span>
          ) : (
            <span className="vi-pill vi-tone-ok">{t('deskDoctorOk')}</span>
          ))}
        <Button size="small" type="text" icon={<IconRefresh size={14} />} loading={loading} onClick={load}>
          {t('deskDoctorRecheck')}
        </Button>
        <Button size="small" onClick={() => navigate('/session')}>
          {t('deskDoctorOpen')}
        </Button>
      </div>

      {!report ? (
        <Skeleton active title={false} paragraph={{rows: 2}} className={styles.doctorSkeleton} />
      ) : (
        <>
          <ul className={styles.checkGrid}>
            {tiles.map((tile) => {
              const Icon = STATUS_ICON[tile.status];
              return (
                <li
                  key={tile.key}
                  className={`${styles.checkTile} ${styles[`check_${tile.status}`]}`}
                  title={tile.text}
                >
                  <span className={styles.checkName}>
                    {Icon ? (
                      <Icon size={15} stroke={1.8} className={styles.checkIcon} aria-hidden="true" />
                    ) : (
                      <span className="vi-dot vi-tone-off" />
                    )}
                    {tile.name}
                  </span>
                  <span className={styles.checkValue}>{tile.value}</span>
                </li>
              );
            })}
          </ul>
          {problems.length > 0 && (
            <ul className={styles.fixList}>
              {problems.map((tile) => (
                <li key={tile.key} className={styles.fixRow}>
                  <span className={`vi-dot ${tile.status === 'error' ? 'vi-tone-danger' : 'vi-tone-warn'}`} />
                  <span className={styles.fixText}>{tile.text}</span>
                  {tile.fix === 'startAppium' && (
                    <Button size="small" type="primary" onClick={() => dispatch(ensureAppium())}>
                      {t('deskStartAppium')}
                    </Button>
                  )}
                  {tile.check?.fix?.action === 'installDriver' && (
                    <Button
                      size="small"
                      loading={fixing === tile.check.fix.driver}
                      onClick={() => installDriver(tile.check.fix.driver)}
                    >
                      {t('doctorInstallDriver', {driver: tile.check.fix.driver})}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
};

export default DoctorPanel;
