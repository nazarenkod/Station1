import {
  IconActivity,
  IconAdjustments,
  IconDeviceFloppy,
  IconDeviceMobile,
  IconInfoCircle,
  IconPlayerPlay,
  IconPlayerStop,
  IconX,
} from '@tabler/icons-react';
import {Alert, Button, Segmented, Tag, Tooltip} from 'antd';
import {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {screenSegments, segmentAt, summarize} from '../../../shared/perf/series.js';
import {activeDevice, isDeviceRunning} from '../../actions/Workstation.js';
import {startQuickSession} from '../../lib/session/quick-session.js';
import {useJoinSession} from '../../lib/session/use-join-session.js';
import {useProfiles} from '../../lib/settings/profiles-store.js';
import {adviceText, useProjectAdvice} from '../../lib/settings/project-advice.js';
import {usePerfConfig} from '../../lib/settings/views.js';
import {backend} from '../../polyfills.js';
import EmptyState from '../Workstation/EmptyState.jsx';
import {AdviceActions} from '../Workstation/ProjectAdvice.jsx';
import {formatElapsed} from '../Workstation/SessionChip.jsx';
import {formatBytes, formatCount, formatMegabytes, formatPercent, MB} from './perf-format.js';
import {buildReport, loadPerfHistory, openRun, selectRun, usePerfHistory} from './perf-history.js';
import {attachPerf, closeRun, startPerf, stopPerf, usePerf} from './perf-store.js';
import PerfChart, {useWidth} from './PerfChart.jsx';
import {BuildsView, ScreensView} from './PerfReport.jsx';
import PerfTolerances from './PerfTolerances.jsx';

import styles from './Perf.module.css';

const RECENT_MS = 10 * 60 * 1000;
// a fresh measurement still shows a minute, so the line does not stretch over the whole width
const MIN_SPAN_MS = 60 * 1000;
// the plot area inside the charts, as PerfChart lays it out
const PLOT_LEFT = 68;
const PLOT_RIGHT = 28;
const PARTS = ['java', 'native', 'graphics', 'code', 'stack', 'other', 'system'];

/**
 * The strip of screens over the charts: each screen the session went
 * through, under its name, for as long as it was on.
 */
const ScreenStrip = ({segments, from, to, hoverAt, unnamed}) => {
  const [ref, width] = useWidth();
  const span = Math.max(1, to - from);
  const left = 52;
  const plot = Math.max(0, width - left - 12);
  const x = (at) => left + ((Math.min(Math.max(at, from), to) - from) / span) * plot;
  return (
    <div ref={ref} className={styles.strip}>
      {segments.map((segment, index) => {
        const start = x(segment.from);
        const size = x(segment.to) - start;
        if (size <= 0) {
          return null;
        }
        const active = hoverAt !== null && hoverAt >= segment.from && hoverAt < segment.to;
        return (
          <span
            key={`${segment.key}-${segment.from}`}
            className={`${styles.stripItem} ${index % 2 ? styles.stripOdd : ''} ${active ? styles.stripActive : ''}`}
            style={{left: start, width: size}}
            title={segment.title ?? unnamed}
          >
            {segment.title ?? unnamed}
          </span>
        );
      })}
    </div>
  );
};

/**
 * What the moment under the pointer says: the values then, and the screen
 * that was on with what it cost while it was.
 */
const HoverCard = ({at, from, to, samples, segments, startedAt, android}) => {
  const {t} = useTranslation();
  const sample = samples.reduce(
    (best, item) => (!best || Math.abs(item.at - at) < Math.abs(best.at - at) ? item : best),
    null,
  );
  const segment = segmentAt(segments, at);
  const summary = segment ? summarize(samples, segment.from, segment.to) : null;
  if (!sample) {
    return null;
  }
  // beside the pointer, on the side with more room
  const part = Math.min(1, Math.max(0, (at - from) / Math.max(1, to - from)));
  return (
    <div
      className={`${styles.hover} ${part > 0.5 ? styles.hoverLeft : ''}`}
      style={{left: `calc(${PLOT_LEFT}px + (100% - ${PLOT_LEFT + PLOT_RIGHT}px) * ${part})`}}
    >
      <div className={styles.hoverTime}>{formatElapsed(sample.at - startedAt)}</div>
      {segment && (
        <div className={styles.hoverScreen}>
          <div className={styles.hoverTitle}>{segment.title ?? t('perfScreenUnnamed')}</div>
          <div className={styles.hoverDim}>{t('perfOnScreen', {time: formatElapsed(segment.to - segment.from)})}</div>
          {summary?.cpuAvg !== null && summary?.cpuAvg !== undefined && (
            <div>{t('perfScreenCpu', {avg: formatPercent(summary.cpuAvg), max: formatPercent(summary.cpuMax)})}</div>
          )}
          {summary?.memoryMax !== null && summary?.memoryMax !== undefined && (
            <div>
              {t('perfScreenMemory', {
                start: formatBytes(summary.memoryStart),
                end: formatBytes(summary.memoryEnd),
                max: formatBytes(summary.memoryMax),
              })}
            </div>
          )}
        </div>
      )}
      {android && sample.parts && (
        <div className={styles.hoverParts}>
          {PARTS.filter((part) => sample.parts[part]).map((part) => (
            <span key={part}>
              {t(`perfPart_${part}`)} <b>{formatBytes(sample.parts[part])}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * The Performance tool: CPU, memory and threads of the app on the device,
 * second by second, with the screens of the session over them.
 */
const PerfTool = () => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const workstation = useSelector((state) => state.workstation);
  const hasSession = useSelector((state) => !!state.inspector.driver);
  const device = activeDevice(workstation);
  const app = workstation.app;
  const perf = usePerf();
  const {decide, joined} = useJoinSession();
  const advice = useProjectAdvice();
  const [range, setRange] = useState('recent');
  const [hoverAt, setHoverAt] = useState(null);
  const [session, setSession] = useState(null);
  const [view, setView] = useState('live');
  const [tolerancesOpen, setTolerancesOpen] = useState(false);
  const history = usePerfHistory();
  const settings = usePerfConfig();
  const profiles = useProfiles();
  const project = profiles.list.find((profile) => profile.id === profiles.activeId)?.name ?? null;
  // the runs kept belong to the app measured, else to the one in the title bar
  const historyAppId = perf.running || perf.viewing ? perf.appId : (app?.id ?? null);

  useEffect(() => {
    attachPerf();
  }, []);
  useEffect(() => {
    loadPerfHistory(historyAppId);
  }, [historyAppId]);

  const openKept = async (id) => {
    if (await openRun(id)) {
      setView('live');
    }
  };
  // the build's report follows the run picked
  const openBuild = (id) => {
    selectRun(id);
    setView('screens');
  };

  // what is saved to a file: the run shown, or the measurement as it goes
  const exportRun = async () => {
    const kept = perf.viewing ? history.runs.find((run) => run.id === perf.viewing) : null;
    const run = kept ?? {
      appId: perf.appId,
      platform: perf.android ? 'android' : 'ios',
      device: device?.name ?? perf.deviceId,
      os: device?.platformVersion ?? '',
      build: {
        version: perf.status.version ?? '',
        number: perf.status.number ?? '',
        kind: perf.status.build ?? 'unknown',
      },
      startedAt: perf.startedAt,
      endAt: perf.samples.at(-1)?.at ?? perf.startedAt,
    };
    const report = kept ? buildReport({...history, selectedId: kept.id}, settings) : null;
    await backend.perf.export({
      run,
      samples: perf.samples,
      markers: perf.markers,
      comparison: report?.comparison ? {reference: report.picked.baseline.build, ...report.comparison} : null,
    });
  };

  const start = async () => {
    setSession(null);
    await startPerf(device, app.id, {markScreen: hasSession});
    if (hasSession) {
      return;
    }
    // the screens come from a session: start one as "Start session" would
    setSession({state: 'starting'});
    const result = await startQuickSession({dispatch, device, app, appium: workstation.appium, decide});
    joined(result);
    setSession(
      result.error || result.refused
        ? {state: 'failed', error: result.error ? t(result.error.key, result.error.params) : null}
        : null,
    );
  };

  const now = perf.samples.at(-1)?.at ?? perf.startedAt ?? 0;
  const to = Math.max(now, (perf.startedAt ?? 0) + MIN_SPAN_MS);
  const from = range === 'recent' ? Math.max(perf.startedAt ?? 0, to - RECENT_MS) : (perf.startedAt ?? 0);
  // the list grows in place: the version says when to look again
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const segments = useMemo(() => screenSegments(perf.markers, now), [perf.version, now]);

  if (!backend.perf) {
    return <EmptyState tool="perf" icon={IconActivity} title={t('perfDesktopOnly')} />;
  }
  const running = isDeviceRunning(device);
  if (!perf.running && !running && !history.runs.length) {
    return (
      <EmptyState
        tool="perf"
        icon={IconActivity}
        title={t('perfNoDeviceTitle')}
        text={t('perfNoDevice')}
        steps={[t('perfStepConnect'), t('perfStepPick'), t('perfStepStart')]}
        actions={
          <Button type="primary" icon={<IconDeviceMobile size={16} />} onClick={() => navigate('/')}>
            {t('perfToDevices')}
          </Button>
        }
      />
    );
  }
  if (!perf.running && perf.samples.length === 0 && !history.runs.length) {
    return (
      <EmptyState
        tool="perf"
        icon={IconActivity}
        title={t('perfIdleTitle')}
        text={app?.id ? t('perfIdleText', {app: app.id}) : advice ? adviceText(t, advice) : t('perfNoApp')}
        steps={[t('perfIdleStepAny'), hasSession ? t('perfIdleStepSession') : t('perfIdleStepNewSession')]}
        actions={
          !app?.id && advice ? (
            <AdviceActions advice={advice} />
          ) : (
            <Button type="primary" icon={<IconPlayerPlay size={16} />} disabled={!app?.id} onClick={start}>
              {t('perfStart')}
            </Button>
          )
        }
      />
    );
  }

  const status = perf.status;
  const android = perf.android;
  const lastPids = perf.samples.at(-1)?.pids ?? [];
  const charts = [
    {
      key: 'cpu',
      label: t('perfChartCpu'),
      hint: t('perfChartCpuHint'),
      value: (s) => s.cpu,
      format: formatPercent,
      floor: 5,
    },
    {
      key: 'memory',
      label: t('perfChartMemory'),
      hint: android ? t('perfChartMemoryHint_android') : t('perfChartMemoryHint_ios'),
      // in megabytes, so the scale falls on round numbers
      value: (s) => (typeof s.memory === 'number' ? s.memory / MB : null),
      format: formatMegabytes,
      floor: 1,
    },
    {key: 'threads', label: t('perfChartThreads'), value: (s) => s.threads, format: formatCount, floor: 5, whole: true},
  ];

  return (
    <div className={styles.tool}>
      <div className={styles.toolbar}>
        {perf.running ? (
          <Button icon={<IconPlayerStop size={16} />} onClick={() => stopPerf()}>
            {t('perfStop')}
          </Button>
        ) : (
          <Button type="primary" icon={<IconPlayerPlay size={16} />} disabled={!app?.id || !running} onClick={start}>
            {t('perfStartAgain')}
          </Button>
        )}
        <span className={`${styles.status} ${styles[`status_${status.state}`] ?? ''}`}>
          <span className={styles.statusDot} />
          {t(`perfState_${status.state}`)}
        </span>
        {status.build === 'debug' && <Tag color="warning">{t('perfBuild_debug')}</Tag>}
        {status.build === 'release' && <Tag>{t('perfBuild_release')}</Tag>}
        {status.flutter && <Tag>Flutter</Tag>}
        <Segmented
          value={view}
          onChange={setView}
          options={[
            {value: 'live', label: t('perfView_live')},
            {value: 'screens', label: t('perfView_screens')},
            {value: 'builds', label: t('perfView_builds', {count: history.runs.length})},
          ]}
        />
        <div className={styles.spacer} />
        {view === 'live' && perf.samples.length > 0 && (
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              {value: 'recent', label: t('perfRange_recent')},
              {value: 'all', label: t('perfRange_all')},
            ]}
          />
        )}
        <Tooltip title={t('perfExport')}>
          <Button
            aria-label={t('perfExport')}
            icon={<IconDeviceFloppy size={16} />}
            disabled={!perf.samples.length}
            onClick={exportRun}
          />
        </Tooltip>
        <Button icon={<IconAdjustments size={16} />} onClick={() => setTolerancesOpen(true)}>
          {t('perfTolerances')}
        </Button>
      </div>
      <PerfTolerances open={tolerancesOpen} onClose={() => setTolerancesOpen(false)} project={project} />
      {perf.viewing && view === 'live' && (
        <Alert
          className={styles.banner}
          type="info"
          showIcon
          title={t('perfViewingRun', {
            build:
              [status.version, status.number ? `(${status.number})` : ''].filter(Boolean).join(' ') ||
              t('perfNoVersion'),
            date: new Date(perf.startedAt).toLocaleString(),
          })}
          action={
            <Button size="small" icon={<IconX size={14} />} onClick={() => closeRun()}>
              {t('perfCloseRun')}
            </Button>
          }
        />
      )}

      {status.state === 'failed' && (
        <Alert
          className={styles.banner}
          type={status.reason === 'iosDevice' ? 'info' : 'error'}
          showIcon
          title={t(`perfFail_${status.reason}`, {defaultValue: t('perfFail_tool')})}
          description={status.error}
        />
      )}
      {session?.state === 'starting' && (
        <Alert className={styles.banner} type="info" showIcon title={t('perfSessionStarting')} />
      )}
      {session?.state === 'failed' && (
        <Alert
          className={styles.banner}
          type="warning"
          showIcon
          title={t('perfSessionFailed')}
          description={session.error}
          closable
          onClose={() => setSession(null)}
        />
      )}

      <div className={styles.body}>
        {view === 'screens' && <ScreensView />}
        {view === 'builds' && <BuildsView onOpenRun={openKept} onOpenBuild={openBuild} />}
        {view === 'live' && !perf.samples.length && (
          <div className={styles.liveEmpty}>
            <p className={styles.reportNote}>{t('perfLiveEmpty')}</p>
            <Button type="primary" icon={<IconPlayerPlay size={16} />} disabled={!app?.id || !running} onClick={start}>
              {t('perfStart')}
            </Button>
          </div>
        )}
        {view === 'live' && perf.samples.length > 0 && (
          <div className={styles.charts}>
            <ScreenStrip segments={segments} from={from} to={to} hoverAt={hoverAt} unnamed={t('perfScreenUnnamed')} />
            {!segments.length && <div className={styles.noScreens}>{t('perfNoScreens')}</div>}
            {charts.map((chart) => (
              <PerfChart
                key={chart.key}
                label={chart.label}
                hint={chart.hint}
                samples={perf.samples}
                value={chart.value}
                format={chart.format}
                floor={chart.floor}
                whole={chart.whole}
                from={from}
                to={to}
                segments={segments}
                markers={perf.markers}
                hoverAt={hoverAt}
                onHover={setHoverAt}
              />
            ))}
            <div className={styles.timeAxis}>
              <span>{formatElapsed(from - (perf.startedAt ?? from))}</span>
              <span>{formatElapsed(to - (perf.startedAt ?? to))}</span>
            </div>
            {hoverAt !== null && (
              <HoverCard
                at={hoverAt}
                from={from}
                to={to}
                samples={perf.samples}
                segments={segments}
                startedAt={perf.startedAt}
                android={android}
              />
            )}
            <p className={styles.note}>
              <IconInfoCircle size={14} />
              {t('perfLoadNote')}
            </p>
          </div>
        )}
      </div>

      <footer className={styles.statusBar}>
        <span className={styles.statusApp}>
          {device?.name ?? perf.deviceId} · <span className={styles.mono}>{perf.appId}</span>
        </span>
        {lastPids.length > 0 && (
          <Tooltip title={t('perfPidsHint')}>
            <span className={styles.mono}>pid {lastPids.join(', ')}</span>
          </Tooltip>
        )}
        <div className={styles.spacer} />
        {perf.startedAt && <span className={styles.mono}>{formatElapsed(now - perf.startedAt)}</span>}
      </footer>
    </div>
  );
};

export default PerfTool;
