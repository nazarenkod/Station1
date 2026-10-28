import {
  IconAccessible,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconChevronRight,
  IconCircleCheck,
  IconPlugConnected,
  IconRefresh,
  IconTerminal2,
} from '@tabler/icons-react';
import {App, Button, Tooltip} from 'antd';
import dayjs from 'dayjs';
import {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {SEVERITIES, severityRank} from '../../../shared/findings/findings.js';
import {perfSettings} from '../../../shared/perf/baseline.js';
import {perfFindings} from '../../../shared/perf/perf-rules.js';
import {usePerfConfig} from '../../lib/settings/views.js';
import {Stagger, StaggerItem} from '../AppShell/motion.jsx';
import GoalsPanel from '../Goals/GoalsPanel.jsx';
import {useLogs} from '../Logs/logs-store.js';
import {lastBuildFindings, usePerfHistory} from '../Perf/perf-history.js';
import {usePerf} from '../Perf/perf-store.js';
import {useProxy} from '../Proxy/proxy-store.js';
import NewTestDialog from './NewTestDialog.jsx';
import TaskPanel from './TaskPanel.jsx';

import styles from './Desk.module.css';

const LISTED = 10;
const TOOL_PATHS = {proxy: '/proxy', logs: '/logs', perf: '/perf', a11y: '/a11y', builds: '/builds'};
// the audit has its own scale; the desk shows everything on the findings scale
const A11Y_SEVERITY = {error: 'high', warning: 'medium', info: 'low'};

/**
 * Everything the tools have found this session, worst first, as one list,
 * and what they have looked at so far.
 */
const useSessionAnalysis = () => {
  const {t} = useTranslation();
  const proxy = useProxy();
  const logs = useLogs();
  const perf = usePerf();
  const perfHistory = usePerfHistory();
  const perfSaved = usePerfConfig();
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
      // what the last measurement showed stays until a new one starts
      ...(perf.samples.length
        ? perfFindings(
            {
              samples: perf.samples,
              markers: perf.markers,
              appId: perf.appId,
              endAt: perf.samples.at(-1).at + 1000,
            },
            perfSettings(perfSaved).rules,
          )
        : []),
      // the app's last build against its reference
      ...lastBuildFindings(perfHistory, perfSaved),
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
      perfSeconds: perf.samples.length,
      screen: scan ? screen?.title || '' : null,
      build: build.status === 'ready' ? build.build : null,
    };
    // the stores change in place: their versions say when
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [t, proxy.version, logs.version, perf.version, perfHistory, perfSaved, scan, screen, build]);
};

const TOOLS = ['proxy', 'logs', 'perf', 'a11y', 'builds'];
const SEVERITY_SHOWN = ['high', 'medium', 'low'];

/**
 * What the session has been checked on so far, as a sentence.
 */
const coverageText = (analysis, t) =>
  [
    analysis.requests > 0 && t('deskCoverage_requests', {count: analysis.requests}),
    analysis.logLines > 0 && t('deskCoverage_lines', {count: analysis.logLines}),
    analysis.perfSeconds > 0 && t('deskCoverage_perf', {minutes: Math.max(1, Math.round(analysis.perfSeconds / 60))}),
    analysis.screen !== null && t('deskCoverage_screen', {screen: analysis.screen || '—'}),
    analysis.build && t('deskCoverage_build', {version: analysis.build.version || analysis.build.build}),
  ]
    .filter(Boolean)
    .join(' · ');

/**
 * The problems of the current test: small counters, a filter by tool, and
 * the list itself, worst first, each opening its tool.
 */
const Problems = ({analysis, expanded, onToggleExpanded}) => {
  const {t} = useTranslation();
  const navigate = useNavigate();
  const hasSession = useSelector((state) => !!state.inspector.driver);
  const [tool, setTool] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const {message} = App.useApp();
  const {rows} = analysis;
  const coverage = coverageText(analysis, t);
  // the anomalies of the last build stay in sight after a restart, with no test running
  const hadSession = hasSession || !!coverage || rows.length > 0;

  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, rows.filter((row) => row.severity === s).length]));
  const byTool = Object.fromEntries(TOOLS.map((key) => [key, rows.filter((row) => row.tool === key).length]));
  const filtered = tool === 'all' ? rows : rows.filter((row) => row.tool === tool);
  // the expanded analytics show every problem; the desk shows the first few
  const shown = showAll || expanded ? filtered : filtered.slice(0, LISTED);

  const newTest = hadSession && (
    <>
      <Button icon={<IconRefresh size={15} />} onClick={() => setResetOpen(true)}>
        {t('deskNewTest')}
      </Button>
      <NewTestDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onDone={(time) => message.success(t('deskNewTestDone', {time}))}
      />
    </>
  );

  const expandButton = (
    <Tooltip title={expanded ? t('deskAnalyticsCollapse') : t('deskAnalyticsExpand')}>
      <Button
        type="text"
        aria-label={expanded ? t('deskAnalyticsCollapse') : t('deskAnalyticsExpand')}
        aria-pressed={expanded}
        icon={expanded ? <IconArrowsMinimize size={16} /> : <IconArrowsMaximize size={16} />}
        onClick={onToggleExpanded}
      />
    </Tooltip>
  );

  if (!hadSession) {
    return (
      <section className={`vi-panel ${styles.problems}`} aria-labelledby="desk-problems">
        <div className={styles.problemsHead}>
          <h2 id="desk-problems" className={styles.problemsTitle}>
            {t('deskProblems')}
          </h2>
          <span className={styles.spacer} />
          {expandButton}
        </div>
        <div className={styles.analyticsEmpty}>
          <span className={styles.analyticsEmptyTitle}>{t('deskNoSessionTitle2')}</span>
          <span className={styles.dim}>{t('deskNoSessionLine')}</span>
          <span className={styles.emptyButtons}>
            <Button icon={<IconPlugConnected size={15} />} onClick={() => navigate('/proxy')}>
              {t('deskCheck_proxy')}
            </Button>
            <Button icon={<IconTerminal2 size={15} />} onClick={() => navigate('/logs')}>
              {t('deskCheck_logs')}
            </Button>
            <Button icon={<IconAccessible size={15} />} onClick={() => navigate('/a11y')}>
              {t('deskAuditScreen')}
            </Button>
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className={`vi-panel ${styles.problems}`} aria-labelledby="desk-problems">
      <div className={styles.problemsHead}>
        <h2 id="desk-problems" className={styles.problemsTitle}>
          {t('deskProblems')}
        </h2>
        {rows.length > 0 && (
          <span className={styles.counters}>
            {SEVERITY_SHOWN.filter((s) => bySeverity[s]).map((s) => (
              <span key={s}>
                <span className={`${styles.sevDot} ${styles[`sev_${s}`]}`} aria-hidden="true" />
                {t(`deskCount_${s}`, {count: bySeverity[s]})}
              </span>
            ))}
          </span>
        )}
        <span className={styles.spacer} />
        {newTest}
        {expandButton}
      </div>
      <div className={styles.problemsSub}>
        <span className={styles.dim}>{coverage ? t('deskCoverage', {list: coverage}) : t('deskCoverageSession')}</span>
        <span className={styles.spacer} />
        {rows.length > 0 && (
          <div className={styles.toolFilter} role="group" aria-label={t('deskByTool')}>
            {['all', ...TOOLS].map((key) =>
              key === 'all' || byTool[key] ? (
                <button
                  key={key}
                  aria-pressed={tool === key}
                  className={`${styles.toolFilterItem} ${tool === key ? styles.toolFilterOn : ''}`}
                  onClick={() => setTool(key)}
                >
                  {key === 'all' ? t('findingsAll') : t(`wsTool_${key}`)}
                  <span className="vi-num">{key === 'all' ? rows.length : byTool[key]}</span>
                </button>
              ) : null,
            )}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className={styles.cleanLine}>
          <IconCircleCheck size={18} stroke={1.6} />
          {t('deskCleanTitle')}
        </div>
      ) : (
        <ul className={styles.findings}>
          {shown.map((row) => (
            <li key={row.id}>
              <button className={styles.finding} onClick={() => navigate(TOOL_PATHS[row.tool])}>
                <span
                  className={`${styles.sevDot} ${styles[`sev_${row.severity}`]}`}
                  title={t(`findingSeverity_${row.severity}`)}
                />
                <span className={styles.findingTitle}>{row.title}</span>
                <span className={`${styles.toolTag} ${styles[`tool_${row.tool}`]}`}>
                  <span className={styles.toolDot} aria-hidden="true" />
                  {t(`wsTool_${row.tool}`)}
                </span>
                <span className={styles.findingMeta}>
                  {row.where || (row.time ? dayjs(row.time).format('HH:mm:ss') : '')}
                </span>
                <span className={`vi-num ${styles.findingCount}`}>{row.count > 1 ? `×${row.count}` : ''}</span>
                <IconChevronRight size={15} className={styles.findingGo} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!expanded && filtered.length > LISTED && (
        <button className={styles.more} onClick={() => setShowAll(!showAll)}>
          {showAll ? t('deskAnalysisShowLess') : t('deskAnalysisShowAll', {count: filtered.length})}
        </button>
      )}
    </section>
  );
};

/**
 * The workstation's home is the work on the task: the task, the goals of the
 * session, and the problems of the current test, which can take the whole
 * desk. The environment and the devices are on the «Station» tab.
 */
const Desk = () => {
  const analysis = useSessionAnalysis();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={styles.desk}>
      <Stagger className={`${styles.inner} ${expanded ? styles.innerExpanded : ''}`}>
        {!expanded && (
          <StaggerItem>
            <TaskPanel />
          </StaggerItem>
        )}
        {!expanded && (
          <StaggerItem>
            <GoalsPanel />
          </StaggerItem>
        )}
        <StaggerItem className={styles.analytics}>
          <Problems analysis={analysis} expanded={expanded} onToggleExpanded={() => setExpanded(!expanded)} />
        </StaggerItem>
      </Stagger>
    </div>
  );
};

export default Desk;
