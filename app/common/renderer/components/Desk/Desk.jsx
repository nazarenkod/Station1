import {
  IconAccessible,
  IconChevronRight,
  IconCircleCheck,
  IconDeviceMobile,
  IconFocus2,
  IconListSearch,
  IconPlayerPlay,
  IconPlugConnected,
  IconRefresh,
  IconTerminal2,
} from '@tabler/icons-react';
import {Alert, Button} from 'antd';
import dayjs from 'dayjs';
import {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {SEVERITIES, severityRank} from '../../../shared/findings/findings.js';
import {activeDevice, isDeviceRunning, refreshDevices, selectDevice} from '../../actions/Workstation.js';
import {backend} from '../../polyfills.js';
import {Stagger, StaggerItem} from '../AppShell/motion.jsx';
import {SeverityTag} from '../Findings/FindingsList.jsx';
import {useLogs} from '../Logs/logs-store.js';
import {useProxy} from '../Proxy/proxy-store.js';
import {appsProblemText, appVersionLabel} from '../Workstation/AppPicker.jsx';
import {deviceSubtitle} from '../Workstation/DevicePicker.jsx';
import {formatElapsed} from '../Workstation/SessionChip.jsx';
import DoctorPanel from './DoctorPanel.jsx';

import styles from './Desk.module.css';

const BOOTABLE = ['android-avd', 'ios-simulator'];
const LISTED = 10;
const TOOL_PATHS = {proxy: '/proxy', logs: '/logs', a11y: '/a11y', builds: '/builds'};
// the audit has its own scale; the desk shows everything on the findings scale
const A11Y_SEVERITY = {error: 'high', warning: 'medium', info: 'low'};

const canBoot = (device) => device.state === 'stopped' && BOOTABLE.includes(device.kind);

/**
 * The current time, ticking every second while `active`.
 */
const useNow = (active) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
};

/**
 * Everything the tools have found this session, worst first, as one list,
 * and what they have looked at so far.
 */
const useSessionAnalysis = () => {
  const {t} = useTranslation();
  const proxy = useProxy();
  const logs = useLogs();
  const scan = useSelector((state) => state.inspector.a11yScan);
  const screen = useSelector((state) => state.inspector.a11yScreen);
  const build = useSelector((state) => state.builds.current);

  return useMemo(() => {
    const titleOf = (finding) =>
      t(`finding_${finding.textKey ?? finding.rule}_title`, {count: finding.count ?? 1, ...finding.params});

    const rows = [
      ...[...proxy.findings.values()].map((f) => ({...f, tool: 'proxy'})),
      ...[...logs.findings.values()].filter((f) => !logs.appId || f.forApp).map((f) => ({...f, tool: 'logs'})),
      ...(build.status === 'ready' ? build.findings.map((f) => ({...f, tool: 'builds'})) : []),
    ].map((finding) => ({
      id: finding.id,
      tool: finding.tool,
      severity: finding.severity,
      title: titleOf(finding),
      count: finding.count ?? 0,
      time: finding.lastTime ?? null,
    }));

    // the audit: one row per rule, on the screen it checked
    const byRule = new Map();
    for (const violation of scan?.violations ?? []) {
      byRule.set(violation.rule, [...(byRule.get(violation.rule) ?? []), violation]);
    }
    for (const [rule, violations] of byRule) {
      rows.push({
        id: `a11y-${rule}`,
        tool: 'a11y',
        severity: A11Y_SEVERITY[violations[0].severity] ?? 'low',
        title: violations[0].title,
        count: violations.length,
        time: null,
        where: screen?.title ?? '',
      });
    }
    rows.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.count - a.count);

    return {
      rows,
      requests: proxy.order.length,
      logLines: logs.entries.length,
      screen: scan ? screen?.title || '' : null,
      build: build.status === 'ready' ? build.build : null,
    };
    // the stores change in place: their versions say when
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [t, proxy.version, logs.version, scan, screen, build]);
};

/**
 * The session in one band: what is being tested, on what, and for how long.
 */
const SessionBar = () => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const workstation = useSelector((state) => state.workstation);
  const hasSession = useSelector((state) => !!state.inspector.driver);
  const startedAt = useSelector((state) => state.inspector.sessionStartTime);
  const {devices, devicesLoaded, app, appsError} = workstation;
  const devicesLoading = workstation.devicesLoading && !workstation.devicesPolling;
  const device = activeDevice(workstation);
  const now = useNow(hasSession);
  const [booting, setBooting] = useState(null);

  const boot = async (candidate) => {
    setBooting(candidate.id);
    try {
      await backend.doctor.bootDevice(candidate);
      await dispatch(refreshDevices());
    } finally {
      setBooting(null);
    }
  };

  let title;
  let sub;
  let actions;
  if (!device) {
    const running = devices.find(isDeviceRunning);
    const bootable = devices.find(canBoot);
    title = devicesLoaded ? t('deskNoDeviceTitle') : t('wsLookingForDevices');
    sub = t('deskNoDeviceText');
    actions = (
      <>
        {running && (
          <Button
            type="primary"
            icon={<IconDeviceMobile size={16} />}
            onClick={() => dispatch(selectDevice(running.id))}
          >
            {t('deskUseDevice', {device: running.name})}
          </Button>
        )}
        {!running && bootable && (
          <Button
            type="primary"
            icon={<IconPlayerPlay size={16} />}
            loading={booting === bootable.id}
            onClick={() => boot(bootable)}
          >
            {t('deskBootDevice', {device: bootable.name})}
          </Button>
        )}
        <Button icon={<IconRefresh size={16} />} loading={devicesLoading} onClick={() => dispatch(refreshDevices())}>
          {t('deskRefreshDevices')}
        </Button>
      </>
    );
  } else {
    title = app ? (app.name && app.name !== app.id ? app.name : app.id) : t('deskNoApp');
    sub = (
      <>
        <span className={`vi-dot ${isDeviceRunning(device) ? 'vi-tone-ok' : 'vi-tone-off'}`} />
        {device.name} · {deviceSubtitle(device, t)}
        {app && <span className="vi-mono">{[app.id, appVersionLabel(app)].filter(Boolean).join(' · ')}</span>}
      </>
    );
    actions = isDeviceRunning(device) ? (
      <>
        <Button
          type="primary"
          icon={<IconFocus2 size={16} />}
          onClick={() => navigate(hasSession ? '/inspector' : '/session')}
        >
          {hasSession ? t('deskOpenSession') : t('deskNewSession')}
        </Button>
        <Button icon={<IconAccessible size={16} />} onClick={() => navigate('/a11y')}>
          {t('deskAuditScreen')}
        </Button>
      </>
    ) : (
      canBoot(device) && (
        <Button
          type="primary"
          icon={<IconPlayerPlay size={16} />}
          loading={booting === device.id}
          onClick={() => boot(device)}
        >
          {t('wsBoot')}
        </Button>
      )
    );
  }

  return (
    <section className={styles.session} aria-labelledby="desk-session">
      <div className={styles.sessionMain}>
        <div className={styles.sessionText}>
          <span className={`vi-eyebrow ${styles.sessionEyebrow}`}>
            {hasSession && <span className="vi-dot vi-dot-live vi-tone-danger" />}
            {hasSession ? t('deskSessionLive', {time: dayjs(startedAt).format('HH:mm')}) : t('deskSessionEyebrow')}
          </span>
          <h1 id="desk-session" className={styles.sessionTitle}>
            {title}
          </h1>
          <span className={styles.sessionSub}>{sub}</span>
        </div>
        <div className={styles.sessionSide}>
          {hasSession && <span className={styles.timer}>{formatElapsed(startedAt ? now - startedAt : 0)}</span>}
          <div className={styles.sessionActions}>{actions}</div>
        </div>
      </div>
      {device && appsError && (
        <Alert className={styles.deviceProblem} type="warning" showIcon title={appsProblemText(appsError, t)} />
      )}
    </section>
  );
};

const TOOLS = ['proxy', 'logs', 'a11y', 'builds'];

/**
 * What the session has been checked on so far, as a sentence.
 */
const coverageText = (analysis, t) =>
  [
    analysis.requests > 0 && t('deskCoverage_requests', {count: analysis.requests}),
    analysis.logLines > 0 && t('deskCoverage_lines', {count: analysis.logLines}),
    analysis.screen !== null && t('deskCoverage_screen', {screen: analysis.screen || '—'}),
    analysis.build && t('deskCoverage_build', {version: analysis.build.version || analysis.build.build}),
  ]
    .filter(Boolean)
    .join(' · ');

/**
 * The problems of the session: how many and how bad, which tool found them,
 * and every one of them, worst first, each opening its tool.
 */
const Problems = ({analysis}) => {
  const {t} = useTranslation();
  const navigate = useNavigate();
  const hasSession = useSelector((state) => !!state.inspector.driver);
  const [severity, setSeverity] = useState('all');
  const [tool, setTool] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const {rows} = analysis;
  const coverage = coverageText(analysis, t);
  const hadSession = hasSession || !!coverage;

  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, rows.filter((row) => row.severity === s).length]));
  const byTool = TOOLS.map((key) => {
    const own = rows.filter((row) => row.tool === key);
    return {key, total: own.length, parts: SEVERITIES.map((s) => own.filter((row) => row.severity === s).length)};
  });
  const peak = Math.max(1, ...byTool.map((entry) => entry.total));
  const filtered = rows.filter(
    (row) => (severity === 'all' || row.severity === severity) && (tool === 'all' || row.tool === tool),
  );
  const shown = showAll ? filtered : filtered.slice(0, LISTED);

  if (!hadSession || !rows.length) {
    return (
      <section className={`vi-panel ${styles.problems}`} aria-labelledby="desk-problems">
        <div className={styles.problemsHead}>
          <h2 id="desk-problems" className={styles.cardTitle}>
            {t('deskProblems')}
          </h2>
        </div>
        <div className={styles.analysisEmpty}>
          <span className={`${styles.emptyIcon} ${hadSession ? styles.emptyIconOk : ''}`} aria-hidden="true">
            {hadSession ? <IconCircleCheck size={26} stroke={1.5} /> : <IconListSearch size={26} stroke={1.5} />}
          </span>
          <strong className={styles.emptyTitle}>{hadSession ? t('deskCleanTitle') : t('deskNoSessionTitle')}</strong>
          <span className={styles.emptyText}>
            {hadSession ? t('deskCoverage', {list: coverage || t('deskCoverageSession')}) : t('deskNoSessionText')}
          </span>
          {!hadSession && (
            <div className={styles.emptyActions}>
              <Button icon={<IconPlugConnected size={16} />} onClick={() => navigate('/proxy')}>
                {t('deskStartProxy')}
              </Button>
              <Button icon={<IconTerminal2 size={16} />} onClick={() => navigate('/logs')}>
                {t('deskStartLogs')}
              </Button>
              <Button icon={<IconAccessible size={16} />} onClick={() => navigate('/a11y')}>
                {t('deskAuditScreen')}
              </Button>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className={`vi-panel ${styles.problems}`} aria-labelledby="desk-problems">
      <div className={styles.problemsHead}>
        <h2 id="desk-problems" className={styles.cardTitle}>
          {t('deskProblems')}
        </h2>
        {coverage && <span className={styles.dim}>{t('deskCoverage', {list: coverage})}</span>}
      </div>

      <div className={styles.summary}>
        <div className={styles.severities} role="group" aria-label={t('findingsFilter')}>
          {['all', ...SEVERITIES.filter((s) => s !== 'info' || bySeverity.info)].map((key) => (
            <button
              key={key}
              aria-pressed={severity === key}
              className={`${styles.severityTile} ${styles[`tile_${key}`]} ${severity === key ? styles.tileOn : ''}`}
              onClick={() => setSeverity(key)}
            >
              <span className={`vi-num ${styles.tileValue}`}>{key === 'all' ? rows.length : bySeverity[key]}</span>
              <span className={styles.tileLabel}>
                {key === 'all' ? t('deskProblemsTotal') : t(`findingSeverity_${key}`)}
              </span>
            </button>
          ))}
        </div>
        <div className={styles.byTool} role="group" aria-label={t('deskByTool')}>
          <span className="vi-eyebrow">{t('deskByTool')}</span>
          {byTool.map((entry) => (
            <button
              key={entry.key}
              aria-pressed={tool === entry.key}
              disabled={!entry.total}
              className={`${styles.toolRow} ${styles[`tool_${entry.key}`]} ${tool === entry.key ? styles.toolRowOn : ''}`}
              onClick={() => setTool(tool === entry.key ? 'all' : entry.key)}
            >
              <span className={styles.toolTag}>
                <span className={styles.toolDot} aria-hidden="true" />
                {t(`wsTool_${entry.key}`)}
              </span>
              <span className={styles.toolBar} aria-hidden="true">
                {entry.parts.map((part, i) =>
                  part ? (
                    <span
                      key={SEVERITIES[i]}
                      className={styles[`sev_${SEVERITIES[i]}`]}
                      style={{width: `${(part / peak) * 100}%`}}
                    />
                  ) : null,
                )}
              </span>
              <span className={`vi-num ${styles.toolCount}`}>{entry.total}</span>
            </button>
          ))}
        </div>
      </div>

      <ul className={styles.findings}>
        {shown.map((row) => (
          <li key={row.id}>
            <button className={styles.finding} onClick={() => navigate(TOOL_PATHS[row.tool])}>
              <SeverityTag severity={row.severity} />
              <span className={styles.findingText}>
                <span className={styles.findingTitle}>{row.title}</span>
                <span className={styles.findingMeta}>
                  <span className={`${styles.toolTag} ${styles[`tool_${row.tool}`]}`}>
                    <span className={styles.toolDot} aria-hidden="true" />
                    {t(`wsTool_${row.tool}`)}
                  </span>
                  {row.where && <span>{row.where}</span>}
                  {row.time && <span className="vi-num">{dayjs(row.time).format('HH:mm:ss')}</span>}
                </span>
              </span>
              {row.count > 1 && <span className={`vi-num ${styles.findingCount}`}>×{row.count}</span>}
              <IconChevronRight size={16} className={styles.findingGo} aria-hidden="true" />
            </button>
          </li>
        ))}
        {!shown.length && <li className={styles.noMatch}>{t('deskNoMatch')}</li>}
      </ul>
      {filtered.length > LISTED && (
        <button className={styles.more} onClick={() => setShowAll(!showAll)}>
          {showAll ? t('deskAnalysisShowLess') : t('deskAnalysisShowAll', {count: filtered.length})}
        </button>
      )}
    </section>
  );
};

/**
 * The workstation's home: whether the machine is ready, the session, and the
 * problems found in it.
 */
const Desk = () => {
  const analysis = useSessionAnalysis();
  return (
    <div className={styles.desk}>
      <Stagger className={styles.inner}>
        <StaggerItem>
          <DoctorPanel />
        </StaggerItem>
        <StaggerItem>
          <SessionBar />
        </StaggerItem>
        <StaggerItem>
          <Problems analysis={analysis} />
        </StaggerItem>
      </Stagger>
    </div>
  );
};

export default Desk;
