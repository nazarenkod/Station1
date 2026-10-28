import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconChartLine,
  IconFlag,
  IconMinus,
  IconPlayerPlay,
  IconTrash,
} from '@tabler/icons-react';
import {Button, Empty, Popconfirm, Select, Table, Tag, Tooltip} from 'antd';
import {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {buildLabel, groupKey, perfSettings, runsOfBuild, sameBuild, trend} from '../../../shared/perf/baseline.js';
import {usePerfConfig} from '../../lib/settings/views.js';
import {formatElapsed} from '../Workstation/SessionChip.jsx';
import {formatBytes, formatPercent} from './perf-format.js';
import {buildReport, deleteRun, makeReference, selectRun, usePerfHistory} from './perf-history.js';
import {niceTop, useWidth} from './PerfChart.jsx';

import styles from './Perf.module.css';

const formatValue = (unit, value) =>
  value === null || value === undefined ? '—' : unit === 'percent' ? formatPercent(value) : formatBytes(value);
const formatChange = (unit, change) =>
  `${change > 0 ? '+' : change < 0 ? '−' : ''}${unit === 'percent' ? formatPercent(Math.abs(change)) : formatBytes(Math.abs(change))}`;
const dateTime = (at) =>
  new Date(at).toLocaleString(undefined, {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'});

const VERDICT_ICON = {worse: IconArrowUpRight, better: IconArrowDownRight, same: IconMinus};

/** One measure: its value, and against the reference how much and which way, in words and an icon. */
const Measure = ({judged, value, unit}) => {
  const {t} = useTranslation();
  if (!judged) {
    return <span className={styles.measureValue}>{formatValue(unit, value?.value ?? value)}</span>;
  }
  const Icon = VERDICT_ICON[judged.verdict];
  return (
    <Tooltip
      title={t('perfMeasureHint', {
        reference: formatValue(judged.unit, judged.reference),
        change: formatChange(judged.unit, judged.change),
      })}
    >
      <span className={styles.measure}>
        <span className={styles.measureValue}>{formatValue(judged.unit, judged.value)}</span>
        <span className={`${styles.verdict} ${styles[`verdict_${judged.verdict}`]}`}>
          <Icon size={12} aria-hidden="true" />
          {judged.verdict === 'same'
            ? t('perfVerdict_same')
            : judged.unit === 'percent'
              ? // CPU is a share already: 0.1% → 5% is +4.9 points, not +4800%
                t('perfPoints', {points: `${judged.change > 0 ? '+' : '−'}${Math.abs(judged.change).toFixed(1)}`})
              : `${judged.share > 0 ? '+' : '−'}${Math.abs(Math.round(judged.share * 100))}%`}
        </span>
      </span>
    </Tooltip>
  );
};

/** Which reference the build is compared with, or why it is not. */
const ReferenceLine = ({report}) => {
  const {t} = useTranslation();
  const {picked, build, isReference} = report;
  if (!picked.baseline) {
    const text =
      picked.reason === 'kind'
        ? t('perfNoRef_kind', {
            kind: t(`perfKind_${build.build.kind}`),
            available: picked.available.map((k) => t(`perfKind_${k}`)).join(', '),
          })
        : picked.reason === 'device'
          ? t('perfNoRef_device', {devices: picked.available.join(', ')})
          : t('perfNoRef_none', {count: report.baselineRuns});
    return <p className={styles.reportNote}>{text}</p>;
  }
  return (
    <p className={styles.reportNote}>
      {isReference
        ? t('perfIsReference')
        : t('perfComparedWith', {
            build: buildLabel(picked.baseline.build),
            count: picked.baseline.runIds.length,
            date: dateTime(picked.baseline.at),
          })}
      {picked.osDiffers && (
        <Tag className={styles.reportTag} color="warning">
          {t('perfOsDiffers', {os: picked.baseline.os})}
        </Tag>
      )}
    </p>
  );
};

/**
 * The screens of the picked run's build against its reference: the app as a
 * whole first, then each named screen.
 */
export const ScreensView = () => {
  const {t} = useTranslation();
  const history = usePerfHistory();
  const settings = usePerfConfig();
  const report = useMemo(() => buildReport(history, settings), [history, settings]);

  if (!report) {
    return <Empty className={styles.reportEmpty} description={t('perfNoRuns')} />;
  }
  const {build, runs} = report;
  // the reference against itself says nothing
  const comparison = report.isReference ? null : report.comparison;
  const judgedApp = Object.fromEntries((comparison?.app ?? []).map((judged) => [judged.measure, judged]));
  const judgedScreens = Object.fromEntries(
    (comparison?.screens ?? []).map((screen) => [
      screen.key,
      Object.fromEntries(screen.measures.map((m) => [m.measure, m])),
    ]),
  );
  const lastRun = report.run;
  const rows = [
    {
      key: '__app',
      title: t('perfWholeApp'),
      app: true,
      cpuAvg: build.app.cpuAvg,
      memoryAvg: build.app.memoryAvg,
      memoryMax: build.app.memoryMax,
      judged: judgedApp,
    },
    ...Object.entries(build.screens).map(([key, screen]) => ({
      key,
      title: screen.title,
      cpuAvg: screen.cpuAvg,
      memoryMax: screen.memoryMax,
      visits: lastRun.summary.screens[key]?.visits ?? null,
      seconds: lastRun.summary.screens[key]?.seconds ?? null,
      judged: judgedScreens[key] ?? {},
    })),
  ];
  const columns = [
    {
      title: t('perfColScreen'),
      dataIndex: 'title',
      render: (title, row) => <span className={row.app ? styles.rowApp : undefined}>{title}</span>,
    },
    {
      title: t('perfColVisits'),
      dataIndex: 'visits',
      width: 110,
      render: (visits, row) =>
        row.app ? '' : visits ? `${visits} · ${formatElapsed((row.seconds ?? 0) * 1000)}` : '—',
    },
    {
      title: t('perfColCpu'),
      dataIndex: 'cpuAvg',
      render: (value, row) => <Measure judged={row.judged.cpuAvg} value={value} unit="percent" />,
    },
    {
      title: t('perfColMemoryAvg'),
      dataIndex: 'memoryAvg',
      render: (value, row) => (row.app ? <Measure judged={row.judged.memoryAvg} value={value} unit="bytes" /> : ''),
    },
    {
      title: t('perfColMemoryMax'),
      dataIndex: 'memoryMax',
      render: (value, row) => <Measure judged={row.judged.memoryMax} value={value} unit="bytes" />,
    },
  ];

  return (
    <div className={styles.report}>
      <div className={styles.reportHead}>
        <h2 className={styles.reportTitle}>
          {buildLabel(build.build) || t('perfNoVersion')}
          <Tag className={styles.reportTag} color={build.build.kind === 'debug' ? 'warning' : undefined}>
            {t(`perfKind_${build.build.kind}`)}
          </Tag>
        </h2>
        <span className={styles.reportMeta}>
          {t('perfBuildMeta', {device: build.device, os: build.os || '—', count: runs.length})}
        </span>
      </div>
      <ReferenceLine report={report} />
      {report.findings.length > 0 && (
        <p className={styles.reportAlert}>
          <IconFlag size={14} aria-hidden="true" />
          {t('perfAnomalies', {count: report.findings.length})}
        </p>
      )}
      <Table size="small" pagination={false} rowKey="key" columns={columns} dataSource={rows} />
      {rows.length === 1 && <p className={styles.reportNote}>{t('perfNoNamedScreens')}</p>}
      {comparison?.onlyBuild.length > 0 && (
        <p className={styles.reportNote}>
          {t('perfOnlyBuild', {screens: comparison.onlyBuild.map((s) => s.title).join(', ')})}
        </p>
      )}
      {comparison?.onlyBaseline.length > 0 && (
        <p className={styles.reportNote}>
          {t('perfOnlyBaseline', {screens: comparison.onlyBaseline.map((s) => s.title).join(', ')})}
        </p>
      )}
    </div>
  );
};

const TREND_MEASURES = ['memoryMax', 'memoryAvg', 'cpuAvg'];
// the whole app in the screen picker
const APP = '__app';
const TREND_HEIGHT = 140;
const TREND_PAD = {left: 64, right: 16, top: 12, bottom: 24};

/** A measure from build to build, with the reference as a dashed line. */
const TrendChart = ({points, reference, unit, onPick, selected}) => {
  const [ref, width] = useWidth();
  const plotWidth = Math.max(0, width - TREND_PAD.left - TREND_PAD.right);
  const plotHeight = TREND_HEIGHT - TREND_PAD.top - TREND_PAD.bottom;
  const top = niceTop(Math.max(...points.map((p) => p.value), reference ?? 0) * 1.1);
  const x = (index) => TREND_PAD.left + (points.length > 1 ? (index / (points.length - 1)) * plotWidth : plotWidth / 2);
  const y = (value) => TREND_PAD.top + plotHeight - (value / top) * plotHeight;
  const line = points
    .map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`)
    .join('');
  return (
    <div ref={ref} className={styles.trend}>
      {width > 0 && (
        <svg width={width} height={TREND_HEIGHT} role="img" aria-label="trend">
          {[0, 0.5, 1].map((part) => (
            <g key={part}>
              <line
                className={styles.grid}
                x1={TREND_PAD.left}
                x2={TREND_PAD.left + plotWidth}
                y1={y(top * part)}
                y2={y(top * part)}
              />
              <text className={styles.axis} x={TREND_PAD.left - 6} y={y(top * part) + 3} textAnchor="end">
                {formatValue(unit, top * part)}
              </text>
            </g>
          ))}
          {reference !== null && reference !== undefined && (
            <line
              className={styles.trendReference}
              x1={TREND_PAD.left}
              x2={TREND_PAD.left + plotWidth}
              y1={y(reference)}
              y2={y(reference)}
            />
          )}
          <path className={styles.line} d={line} />
          {points.map((point, index) => (
            <g key={point.lastRunId} className={styles.trendPoint} onClick={() => onPick(point)}>
              <title>{`${buildLabel(point.build)} · ${formatValue(unit, point.value)}`}</title>
              {/* a target larger than the mark */}
              <circle cx={x(index)} cy={y(point.value)} r={12} className={styles.hit} />
              <circle
                cx={x(index)}
                cy={y(point.value)}
                r={point.lastRunId === selected ? 6 : 4}
                className={styles.dot}
              />
              <text className={styles.axis} x={x(index)} y={TREND_HEIGHT - 6} textAnchor="middle">
                {point.build.version || '—'}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
};

/**
 * The builds of the app on this device: their runs, which one is the
 * reference, making one, and how a measure went from build to build.
 */
export const BuildsView = ({onOpenRun, onOpenBuild}) => {
  const {t} = useTranslation();
  const history = usePerfHistory();
  const saved = usePerfConfig();
  const settings = perfSettings(saved);
  const [measure, setMeasure] = useState('memoryMax');
  const [screen, setScreen] = useState(APP);
  const [busy, setBusy] = useState(null);
  const selected = history.runs.find((run) => run.id === history.selectedId) ?? history.runs.at(-1);

  const builds = useMemo(() => {
    const list = [];
    for (const run of [...history.runs].sort((a, b) => b.startedAt - a.startedAt)) {
      const known = list.find(
        (entry) => entry.platform === run.platform && entry.device === run.device && sameBuild(entry.build, run.build),
      );
      if (known) {
        known.runs.push(run);
      } else {
        list.push({key: run.id, build: run.build, platform: run.platform, device: run.device, runs: [run]});
      }
    }
    return list;
  }, [history.runs]);

  if (!history.runs.length) {
    return <Empty className={styles.reportEmpty} description={t('perfNoRuns')} />;
  }

  const isReference = (entry) =>
    (history.baselines[groupKey({...entry.runs[0]})]?.current?.runIds ?? []).some((id) =>
      entry.runs.some((run) => run.id === id),
    );
  const group = selected ? {platform: selected.platform, device: selected.device, kind: selected.build.kind} : null;
  const screenKey = screen === APP ? null : screen;
  const points = group ? trend(history.runs, group, measure, screenKey) : [];
  const reference = group ? history.baselines[`${group.platform}|${group.device}|${group.kind}`]?.current : null;
  const referenceValue = reference
    ? screenKey
      ? reference.screens[screenKey]?.[measure]?.value
      : reference.app[measure]?.value
    : null;
  const screenOptions = [
    {value: APP, label: t('perfWholeApp')},
    ...[
      ...new Map(
        history.runs.flatMap((run) => Object.entries(run.summary.screens).map(([key, item]) => [key, item.title])),
      ),
    ].map(([key, title]) => ({value: key, label: title})),
  ];
  const unit = measure === 'cpuAvg' ? 'percent' : 'bytes';

  const makeRef = async (entry) => {
    setBusy(entry.key);
    try {
      await makeReference(entry.runs[0].id);
    } finally {
      setBusy(null);
    }
  };

  const columns = [
    {
      title: t('perfColBuild'),
      key: 'build',
      render: (_, entry) => (
        <span className={styles.buildCell}>
          <button type="button" className={styles.linkButton} onClick={() => onOpenBuild(entry.runs[0].id)}>
            {buildLabel(entry.build) || t('perfNoVersion')}
          </button>
          <Tag color={entry.build.kind === 'debug' ? 'warning' : undefined}>{t(`perfKind_${entry.build.kind}`)}</Tag>
          {isReference(entry) && <Tag color="processing">{t('perfReference')}</Tag>}
        </span>
      ),
    },
    {title: t('perfColDevice'), dataIndex: 'device'},
    {title: t('perfColRuns'), key: 'runs', width: 90, render: (_, entry) => entry.runs.length},
    {
      title: '',
      key: 'actions',
      width: 210,
      render: (_, entry) => {
        const missing = settings.baselineRuns - runsOfBuild(history.runs, entry.runs[0]).length;
        if (isReference(entry)) {
          return null;
        }
        return missing > 0 ? (
          <span className={styles.reportMeta}>{t('perfRunsMissing', {count: missing})}</span>
        ) : (
          <Button size="small" loading={busy === entry.key} onClick={() => makeRef(entry)}>
            {t('perfMakeReference')}
          </Button>
        );
      },
    },
  ];

  const runColumns = [
    {title: t('perfColStarted'), key: 'at', render: (_, run) => dateTime(run.startedAt)},
    {title: t('perfColDuration'), key: 'length', render: (_, run) => formatElapsed(run.endAt - run.startedAt)},
    {title: t('perfColOs'), dataIndex: 'os'},
    {
      title: '',
      key: 'actions',
      width: 120,
      render: (_, run) => (
        <span className={styles.rowActions}>
          <Tooltip title={t('perfOpenRun')}>
            <Button
              size="small"
              type="text"
              icon={<IconPlayerPlay size={14} />}
              aria-label={t('perfOpenRun')}
              onClick={() => onOpenRun(run.id)}
            />
          </Tooltip>
          <Popconfirm title={t('perfDeleteRunConfirm')} onConfirm={() => deleteRun(run.id)} okText={t('perfDeleteRun')}>
            <Button size="small" type="text" icon={<IconTrash size={14} />} aria-label={t('perfDeleteRun')} />
          </Popconfirm>
        </span>
      ),
    },
  ];

  return (
    <div className={styles.report}>
      <Table
        size="small"
        pagination={false}
        rowKey="key"
        columns={columns}
        dataSource={builds}
        expandable={{
          expandedRowRender: (entry) => (
            <Table
              size="small"
              pagination={false}
              rowKey="id"
              columns={runColumns}
              dataSource={entry.runs}
              showHeader
            />
          ),
        }}
      />
      {group && (
        <section className={styles.trendBlock} aria-label={t('perfTrend')}>
          <div className={styles.trendHead}>
            <IconChartLine size={16} aria-hidden="true" />
            <span className={styles.chartLabel}>{t('perfTrend')}</span>
            <span className={styles.reportMeta}>
              {group.device} · {t(`perfKind_${group.kind}`)}
            </span>
            <div className={styles.spacer} />
            <Select
              size="small"
              value={screen}
              onChange={setScreen}
              options={screenOptions}
              className={styles.trendSelect}
            />
            <Select
              size="small"
              value={measure}
              onChange={setMeasure}
              options={TREND_MEASURES.map((value) => ({value, label: t(`perfMeasure_${value}`)}))}
              className={styles.trendSelect}
            />
          </div>
          {points.length ? (
            <TrendChart
              points={points}
              reference={referenceValue}
              unit={unit}
              selected={selected?.id}
              onPick={(point) => {
                selectRun(point.lastRunId);
                onOpenBuild(point.lastRunId);
              }}
            />
          ) : (
            <p className={styles.reportNote}>{t('perfTrendEmpty')}</p>
          )}
          {referenceValue !== null && referenceValue !== undefined && (
            <p className={styles.reportNote}>{t('perfTrendReference', {value: formatValue(unit, referenceValue)})}</p>
          )}
        </section>
      )}
    </div>
  );
};
