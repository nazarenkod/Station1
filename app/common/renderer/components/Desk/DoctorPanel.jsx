import {IconChevronDown, IconCopy, IconPlayerPlay, IconRefresh, IconSettings, IconSparkles} from '@tabler/icons-react';
import {App, Button, Popover, Skeleton} from 'antd';
import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {ensureAppium} from '../../actions/Workstation.js';
import {askOnTask} from '../../lib/agent/agent-store.js';
import {backend} from '../../polyfills.js';
import {useLogs} from '../Logs/logs-store.js';
import {useProxy} from '../Proxy/proxy-store.js';
import {fixForCheck} from './doctor-fixes.js';
import {loadDoctor, serverStatusOf, useDoctor} from './doctor-store.js';

import styles from './Desk.module.css';

// the short name of each check of the doctor, for its row
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
  kiro: 'kiro',
  kiroMissing: 'kiro',
  kiroV3: 'kiro',
  kiroLogin: 'kiro',
  shellEnv: 'shellEnv',
  doctorFailed: 'doctorFailed',
};

/**
 * A command to paste into a terminal, with a button that copies it.
 */
export const Command = ({command}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  return (
    <div className={styles.command}>
      <code>{command}</code>
      <Button
        size="small"
        type="text"
        icon={<IconCopy size={14} />}
        onClick={() => navigator.clipboard.writeText(command).then(() => message.success(t('deskFixCopied')))}
      >
        {t('deskFixCopy')}
      </Button>
    </div>
  );
};

/**
 * What a row of a status list says when pointed at: what is wrong and how to
 * fix it, with the command to run or a button that does it.
 */
export const StatusCard = ({name, value, status, text, fixText, command, action, agent}) => {
  const {t} = useTranslation();
  return (
    <div className={styles.statusCard}>
      <div className={styles.statusCardHead}>
        <span className={`${styles.statusDot} ${styles[`status_${status}`]}`} aria-hidden="true" />
        <span className={styles.statusCardName}>
          <b>{name}</b>
          {value && <span className={styles.statusCardValue}>{value}</span>}
        </span>
        <span className={`${styles.statusCardState} ${styles[`statusText_${status}`]}`}>
          {t(`deskStatus_${status}`)}
        </span>
      </div>
      {text && (
        <div className={styles.statusCardBlock}>
          {(status === 'warn' || status === 'error') && <span className="vi-eyebrow">{t('deskWhatsWrong')}</span>}
          <span>{text}</span>
        </div>
      )}
      {(fixText || command || action) && (
        <div className={styles.statusCardBlock}>
          <span className="vi-eyebrow">{t('deskHowToFix')}</span>
          {fixText && <span>{fixText}</span>}
          {command && <Command command={command} />}
          {action}
        </div>
      )}
      {agent && (
        <div className={styles.statusCardAgent}>
          <Button size="small" icon={<IconSparkles size={14} />} onClick={agent}>
            {t('deskFixWithAgent')}
          </Button>
        </div>
      )}
    </div>
  );
};

/**
 * One line of a status list; pointing at it (or focusing it) shows its card.
 */
export const needsFix = (status) => status === 'warn' || status === 'error';

/**
 * Shows the card of a row that needs fixing; a fine row only gets a plain
 * tooltip, there is nothing to tell about it.
 */
export const RowCard = ({card: {key: _key, ...card}, placement, children}) =>
  needsFix(card.status) ? (
    <Popover
      content={<StatusCard {...card} />}
      placement={placement}
      trigger={['hover', 'focus']}
      mouseEnterDelay={0.15}
      arrow={false}
    >
      {children}
    </Popover>
  ) : (
    children
  );

export const StatusRow = ({row}) => (
  <li>
    <RowCard card={row} placement="bottomLeft">
      <button
        className={`${styles.statusRow} ${styles[`statusRow_${row.status}`]}`}
        title={needsFix(row.status) ? undefined : row.text}
      >
        <span className={`${styles.statusDot} ${styles[`status_${row.status}`]}`} aria-hidden="true" />
        <span className={styles.statusName}>{row.name}</span>
        <span className={styles.statusValue}>{row.value}</span>
      </button>
    </RowCard>
  </li>
);

// both lists on the desk show this many rows, so the two panels line up
export const VISIBLE_ROWS = 5;

/**
 * The foot of a fixed-size list: how many rows are out of view, and a
 * button that opens the list to its full length.
 */
export const PanelFoot = ({open, onToggle, hidden, summary}) => {
  const {t} = useTranslation();
  if (!hidden && !open) {
    return <div className={styles.panelFoot}>{summary}</div>;
  }
  return (
    <button className={`${styles.panelFoot} ${styles.expand}`} aria-expanded={open} onClick={onToggle}>
      <span className={styles.expandText}>{open ? t('deskCollapse') : t('deskExpandMore', {count: hidden})}</span>
      <IconChevronDown size={14} className={open ? styles.chevronOpen : styles.chevron} />
    </button>
  );
};

const isProblem = (row) => needsFix(row.status);

// the terminal environment and Java: when either goes missing the rest fails in odd ways
const PINNED_CHECKS = ['shellEnv', 'java'];

/**
 * What the operator is asked to fix: the check, what is wrong, and what the
 * station would do about it, so it can start fixing right away.
 */
const fixPrompt = (t, check, fix) => {
  const raw = {interpolation: {escapeValue: false}};
  const advice = fix ? t(`deskFix_${fix.key}`, {defaultValue: ''}) : '';
  return [
    t('deskFixWithAgentPrompt', {
      name: t(`deskCheck_${CHECK_NAME[check.id] ?? check.id}`, check.params),
      text: t(`doctorCheck_${check.id}_${check.status}`, check.params),
      id: check.id,
      ...raw,
    }),
    advice && t('deskFixWithAgentAdvice', {advice, ...raw}),
    fix?.command && t('deskFixWithAgentCommand', {command: fix.command, ...raw}),
    t('deskFixWithAgentDo'),
  ]
    .filter(Boolean)
    .join('\n');
};

/** One list of the environment: its head with the count of problems, the rows, the foot. */
const EnvList = ({id, title, rows, report, loading, onRecheck, fit = false, okText, okMuted = false}) => {
  const {t} = useTranslation();
  const [open, setOpen] = useState(false);
  const problems = rows.filter(isProblem);
  const rest = [
    ...rows.filter((row) => !isProblem(row) && row.pinned),
    ...rows.filter((row) => !isProblem(row) && !row.pinned),
  ];
  return (
    <section
      className={`vi-panel ${styles.listPanel} ${open ? styles.listPanelOpen : ''} ${fit ? styles.listPanelFit : ''}`}
      aria-labelledby={id}
    >
      <div className={styles.panelHead}>
        <h2 id={id} className={styles.cardTitle}>
          {title}
        </h2>
        {report &&
          (problems.length ? (
            <span className={problems.some((row) => row.status === 'error') ? styles.headError : styles.headWarn}>
              {t('deskEnvIssues', {count: problems.length})}
            </span>
          ) : (
            <span className={okMuted ? styles.dim : styles.headOk}>{okText ?? t('deskDoctorOk')}</span>
          ))}
        <span className={styles.spacer} />
        {onRecheck && (
          <Button
            size="small"
            type="text"
            aria-label={t('deskDoctorRecheck')}
            title={t('deskDoctorRecheck')}
            icon={<IconRefresh size={14} />}
            loading={loading}
            onClick={onRecheck}
          />
        )}
      </div>

      {!report ? (
        <Skeleton active title={false} paragraph={{rows: 4}} className={styles.panelSkeleton} />
      ) : (
        <>
          <ul className={styles.statusList}>
            {[...problems, ...rest].map((row) => (
              <StatusRow key={row.key} row={row} />
            ))}
          </ul>
          <PanelFoot
            open={open}
            onToggle={() => setOpen(!open)}
            hidden={Math.max(0, rows.length - VISIBLE_ROWS)}
            summary={t('deskEnvTotal', {count: rows.length})}
          />
        </>
      )}
    </section>
  );
};

/**
 * The environment as lists with a coloured status per line: the tools of
 * this Mac (the doctor's checks), the station's own services (the Appium
 * server, the proxy, the log) and the integrations (Kiro CLI, Jira, GitLab).
 * Problems stay in view; the rest folds away until opened.
 */
const DoctorPanel = () => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const appium = useSelector((state) => state.workstation.appium);
  const proxy = useProxy();
  const logs = useLogs();
  const {report, loading} = useDoctor();
  const [fixing, setFixing] = useState(null);
  const load = useCallback(() => loadDoctor({again: true}), []);

  useEffect(() => {
    loadDoctor();
  }, []);

  if (!backend.doctor) {
    return null;
  }

  const runFix = async (key, task) => {
    setFixing(key);
    try {
      await task();
      await load();
    } finally {
      setFixing(null);
    }
  };

  const actionFor = (fix) => {
    if (fix?.action?.kind === 'installDriver') {
      return (
        <Button
          size="small"
          type="primary"
          loading={fixing === fix.action.driver}
          onClick={() => runFix(fix.action.driver, () => backend.doctor.installDriver(fix.action.driver))}
        >
          {t('doctorInstallDriver', {driver: fix.action.driver})}
        </Button>
      );
    }
    if (fix?.action?.kind === 'installAppium') {
      return (
        <Button
          size="small"
          type="primary"
          loading={fixing === 'appium'}
          onClick={() =>
            runFix('appium', () =>
              backend.doctor.installAppium(['uiautomator2', ...(/mac/i.test(navigator.platform) ? ['xcuitest'] : [])]),
            )
          }
        >
          {t('deskFixInstallAppium')}
        </Button>
      );
    }
    return null;
  };

  const toSettings = (
    <Button size="small" icon={<IconSettings size={14} />} onClick={() => navigate('/settings')}>
      {t('deskOpenSettings')}
    </Button>
  );

  const serverStatus = serverStatusOf(appium);

  const checks = (report?.checks ?? []).map((check, i) => {
    const fix = fixForCheck(check);
    return {
      key: `${check.id}-${check.params?.driver ?? i}`,
      name: t(`deskCheck_${CHECK_NAME[check.id] ?? check.id}`, check.params),
      // a missing tool says so instead of a bare status
      value:
        check.params?.version ||
        t(`deskCheckValue_${check.id}_${check.status}`, {...check.params, defaultValue: ''}) ||
        t(`deskCheckValue_${check.id}`, {defaultValue: ''}) ||
        t(check.id.endsWith('Missing') ? 'deskCheckValue_missing' : `deskCheckValue_${check.status}`),
      status: check.status,
      text: t(`doctorCheck_${check.id}_${check.status}`, check.params),
      fixText: fix ? t(`deskFix_${fix.key}`, {defaultValue: ''}) : '',
      command: fix?.command,
      action: actionFor(fix),
      // the operator gets the whole problem with the station's advice and fixes it with the person's yes
      agent:
        needsFix(check.status) && check.id !== 'doctorFailed'
          ? () => askOnTask(fixPrompt(t, check, fix), {topic: `fix:${check.id}`})
          : null,
      // Kiro CLI is the operator's way out of the Mac: an integration, as Jira and GitLab are
      integration: check.id.startsWith('kiro'),
      // what everything else stands on stays in sight, never folded away
      pinned: PINNED_CHECKS.includes(check.id),
    };
  });
  // the tools on this Mac the station needs
  const environment = checks.filter((row) => !row.integration);
  // what the station itself runs
  const services = [
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
      status: serverStatus,
      text:
        serverStatus === 'ok'
          ? t('deskCheckServerOn')
          : appium?.error
            ? t(`doctorServerError_${appium.error.split(':')[0]}`, {
                port: 4723,
                detail: appium.error.split(':')[1],
                defaultValue: appium.error,
              })
            : t('deskCheckServerOff'),
      fixText: serverStatus === 'ok' ? '' : t('deskFix_server'),
      action: serverStatus !== 'ok' && (
        <Button
          size="small"
          type="primary"
          icon={<IconPlayerPlay size={14} />}
          onClick={() => dispatch(ensureAppium())}
        >
          {t('deskStartAppium')}
        </Button>
      ),
    },
    {
      key: 'proxy',
      name: t('deskCheck_proxy'),
      value: proxy.status.running ? `:${proxy.status.port}` : t('deskCheckValue_stopped'),
      status: proxy.status.running ? 'ok' : 'off',
      text: proxy.status.running ? t('deskCheckProxyOn') : t('deskCheckProxyOff'),
    },
    {
      key: 'logs',
      name: t('deskCheck_logs'),
      value: logs.started ? t('deskCheckValue_recording') : t('deskCheckValue_stopped'),
      status: logs.started ? 'ok' : 'off',
      text: logs.started ? t('deskCheckLogsOn') : t('deskCheckLogsOff'),
    },
  ];
  const integrations = [
    ...checks.filter((row) => row.integration),
    ...['jira', 'gitlab'].map((key) => ({
      key,
      name: t(`deskCheck_${key}`),
      value: report?.integrations?.[key] ? t('deskCheckValue_connected') : t('deskCheckValue_notConnected'),
      status: report?.integrations?.[key] ? 'ok' : 'off',
      text: report?.integrations?.[key] ? t(`deskCheck_${key}On`) : t(`deskCheck_${key}Off`),
      action: !report?.integrations?.[key] && toSettings,
    })),
  ];

  return (
    <div className={styles.envColumn}>
      <EnvList
        id="desk-environment"
        title={t('deskEnvMac')}
        rows={environment}
        report={report}
        loading={loading}
        onRecheck={load}
      />
      <EnvList id="desk-services" title={t('deskEnvServices')} rows={services} report={report} fit />
      <EnvList
        id="desk-integrations"
        title={t('deskEnvIntegrations')}
        rows={integrations}
        report={report}
        fit
        okMuted={integrations.some((row) => row.status !== 'ok')}
        okText={t('deskEnvConnected', {
          count: integrations.filter((row) => row.status === 'ok').length,
          total: integrations.length,
        })}
      />
    </div>
  );
};

export default DoctorPanel;
