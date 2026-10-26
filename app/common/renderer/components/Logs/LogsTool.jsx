import {
  IconArrowDown,
  IconDeviceFloppy,
  IconDeviceMobile,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTerminal2,
  IconTrash,
} from '@tabler/icons-react';
import {Alert, App, Button, Input, Select, Switch, Tooltip} from 'antd';
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {SEVERITIES, severityRank} from '../../../shared/findings/findings.js';
import {LOG_LEVELS} from '../../../shared/findings/log-rules.js';
import {activeDevice, isDeviceRunning} from '../../actions/Workstation.js';
import {backend} from '../../polyfills.js';
import {SeverityTag} from '../Findings/FindingsList.jsx';
import EmptyState from '../Workstation/EmptyState.jsx';
import {clearLogs, saveRules, startLogs, useLogs} from './logs-store.js';

import styles from './Logs.module.css';

const ROW_HEIGHT = 24;
const OVERSCAN = 20;
const LEVEL_NAMES = {V: 'Verbose', D: 'Debug', I: 'Info', W: 'Warning', E: 'Error', F: 'Fatal'};

const firstLine = (message) => {
  const end = message.indexOf('\n');
  return end < 0 ? message : message.slice(0, end);
};
const extraLines = (message) => {
  let count = 0;
  for (let i = message.indexOf('\n'); i >= 0; i = message.indexOf('\n', i + 1)) {
    count++;
  }
  return count;
};

/**
 * The lines on screen, drawn only where the viewport is: a log of twenty
 * thousand lines scrolls like one of twenty.
 */
const LogList = ({rows, selected, onSelect, follow, onFollowChange, ruleNames}) => {
  const {t} = useTranslation();
  const scroller = useRef(null);
  const [scroll, setScroll] = useState({top: 0, height: 600});

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && follow) {
      el.scrollTop = el.scrollHeight;
    }
  }, [rows, follow]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(() => setScroll((s) => ({...s, height: el.clientHeight})));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onScroll = (event) => {
    const el = event.currentTarget;
    setScroll({top: el.scrollTop, height: el.clientHeight});
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < ROW_HEIGHT * 2;
    if (atBottom !== follow) {
      onFollowChange(atBottom);
    }
  };

  const first = Math.max(0, Math.floor(scroll.top / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scroll.top + scroll.height) / ROW_HEIGHT) + OVERSCAN);
  const visible = rows.slice(first, last);

  return (
    <div className={styles.scroller} ref={scroller} onScroll={onScroll} role="log" aria-live="off">
      <div style={{height: rows.length * ROW_HEIGHT, position: 'relative'}}>
        <div style={{position: 'absolute', top: first * ROW_HEIGHT, left: 0, right: 0}}>
          {visible.map((entry) =>
            entry.kind === 'marker' ? (
              <div key={entry.seq} className={styles.marker} style={{height: ROW_HEIGHT}}>
                <span className={styles.markerLine} />
                {t(entry.event === 'start' ? 'logsProcessStarted' : 'logsProcessEnded', {pid: entry.pid})}
                <span className={styles.markerLine} />
              </div>
            ) : (
              <button
                key={entry.seq}
                className={`${styles.row} ${entry.hits?.length ? styles.rowHit : ''} ${selected === entry.seq ? styles.rowSelected : ''} ${entry.app ? '' : styles.rowSystem}`}
                style={{height: ROW_HEIGHT}}
                onClick={() => onSelect(entry.seq)}
              >
                <span className={styles.time}>{entry.time}</span>
                <span className={styles.pid}>{entry.pid}</span>
                <span className={`${styles.level} ${styles[`level_${entry.level}`]}`}>{entry.level}</span>
                <span className={styles.tag}>{entry.tag}</span>
                <span className={`${styles.message} ${styles[`msg_${entry.level}`] ?? ''}`}>
                  {firstLine(entry.message)}
                </span>
                {extraLines(entry.message) > 0 && <span className={styles.more}>+{extraLines(entry.message)}</span>}
                {entry.hits?.map((rule) => (
                  <span key={rule} className={styles.hit}>
                    {ruleNames[rule] ?? rule}
                  </span>
                ))}
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * The rules that fired, worst first; a click shows only their lines.
 */
const LogFindings = ({findings, ruleFilter, onRuleFilter}) => {
  const {t} = useTranslation();
  const byRule = useMemo(() => {
    const groups = new Map();
    for (const finding of findings) {
      const group = groups.get(finding.rule) ?? {rule: finding.rule, finding, count: 0, kinds: 0};
      group.count += finding.count;
      group.kinds += 1;
      groups.set(finding.rule, group);
    }
    return [...groups.values()].sort(
      (a, b) => severityRank(a.finding.severity) - severityRank(b.finding.severity) || b.count - a.count,
    );
  }, [findings]);

  if (!byRule.length) {
    return <div className={styles.quiet}>{t('logsNoFindings')}</div>;
  }
  return (
    <div className={styles.findings}>
      {byRule.map(({rule, finding, count, kinds}) => {
        const key = finding.textKey ?? rule;
        const params = {count: kinds, ...finding.params};
        const on = ruleFilter === rule;
        return (
          <button
            key={rule}
            className={`${styles.finding} ${on ? styles.findingOn : ''}`}
            aria-pressed={on}
            onClick={() => onRuleFilter(on ? null : rule)}
          >
            <span className={styles.findingHead}>
              <SeverityTag severity={finding.severity} />
              <span className={styles.findingCount}>×{count}</span>
            </span>
            <span className={styles.findingTitle}>{t(`finding_${key}_title`, params)}</span>
            <span className={styles.findingWhy}>{t(`finding_${key}_why`, params)}</span>
            <span className={styles.findingLast}>{t('logsLastSeen', {time: finding.lastTime})}</span>
          </button>
        );
      })}
    </div>
  );
};

const NEW_RULE = {name: '', pattern: '', tag: '', minLevel: 'V', severity: 'medium', scope: 'app'};

/**
 * The project's own patterns: a name, a regular expression, optionally a tag
 * and a level from which the line counts.
 */
const CustomRules = ({rules}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const [draft, setDraft] = useState(null);

  const save = async (custom) => saveRules({...rules, custom});
  const patternError = useMemo(() => {
    if (!draft?.pattern) {
      return null;
    }
    try {
      new RegExp(draft.pattern);
      return null;
    } catch (error) {
      return error.message;
    }
  }, [draft]);

  const add = async () => {
    await save([...rules.custom, {...draft, id: Date.now().toString(36), enabled: true}]);
    setDraft(null);
    message.success(t('logsRuleAdded'));
  };

  return (
    <div className={styles.custom}>
      {rules.custom.map((rule) => (
        <div key={rule.id} className={styles.customRule}>
          <Switch
            size="small"
            checked={rule.enabled !== false}
            onChange={(enabled) => save(rules.custom.map((r) => (r.id === rule.id ? {...r, enabled} : r)))}
          />
          <span className={styles.customText}>
            <span className={styles.strong}>{rule.name}</span>
            <code className={styles.code}>
              {rule.tag ? `${rule.tag}: ` : ''}/{rule.pattern}/
            </code>
          </span>
          <Tooltip title={t('logsRuleDelete')}>
            <Button
              size="small"
              type="text"
              aria-label={t('logsRuleDelete')}
              icon={<IconTrash size={14} />}
              onClick={() => save(rules.custom.filter((r) => r.id !== rule.id))}
            />
          </Tooltip>
        </div>
      ))}
      {draft ? (
        <div className={styles.draft}>
          <Input
            placeholder={t('logsRuleName')}
            value={draft.name}
            onChange={(e) => setDraft({...draft, name: e.target.value})}
          />
          <Input
            placeholder={t('logsRulePattern')}
            value={draft.pattern}
            status={patternError ? 'error' : undefined}
            onChange={(e) => setDraft({...draft, pattern: e.target.value})}
            className={styles.monoInput}
          />
          {patternError && <span className={styles.errorText}>{patternError}</span>}
          <div className={styles.draftRow}>
            <Input
              placeholder={t('logsRuleTag')}
              value={draft.tag}
              onChange={(e) => setDraft({...draft, tag: e.target.value})}
              className={styles.monoInput}
            />
            <Select
              value={draft.minLevel}
              onChange={(minLevel) => setDraft({...draft, minLevel})}
              options={LOG_LEVELS.map((level) => ({value: level, label: `${level}+`}))}
              style={{width: 80}}
            />
            <Select
              value={draft.severity}
              onChange={(severity) => setDraft({...draft, severity})}
              options={SEVERITIES.map((severity) => ({value: severity, label: t(`findingSeverity_${severity}`)}))}
              style={{width: 110}}
            />
          </div>
          <Select
            value={draft.scope}
            onChange={(scope) => setDraft({...draft, scope})}
            options={[
              {value: 'app', label: t('logsRuleScope_app')},
              {value: 'device', label: t('logsRuleScope_device')},
            ]}
          />
          <div className={styles.draftRow}>
            <Button type="primary" disabled={!draft.name.trim() || !draft.pattern || !!patternError} onClick={add}>
              {t('logsRuleSave')}
            </Button>
            <Button type="text" onClick={() => setDraft(null)}>
              {t('Cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button icon={<IconPlus size={14} />} onClick={() => setDraft(NEW_RULE)} className={styles.addRule}>
          {t('logsRuleAdd')}
        </Button>
      )}
    </div>
  );
};

/**
 * The Logs tool: the device log with the app's lines picked out, the rules
 * that fired and the app's processes.
 */
const LogsTool = () => {
  const {t} = useTranslation();
  const navigate = useNavigate();
  const workstation = useSelector((state) => state.workstation);
  const device = activeDevice(workstation);
  const appId = workstation.app?.id ?? null;
  const logs = useLogs();

  const [onlyApp, setOnlyApp] = useState(true);
  const [minLevel, setMinLevel] = useState('V');
  const [query, setQuery] = useState('');
  const [ruleFilter, setRuleFilter] = useState(null);
  const [follow, setFollow] = useState(true);
  const [frozen, setFrozen] = useState(null);
  const [selected, setSelected] = useState(null);

  const running = isDeviceRunning(device);
  useEffect(() => {
    if (running) {
      startLogs(device, appId);
    }
  }, [running, device, appId]);

  // short names for the chips on the lines: built-in rules by their key, custom ones by the name given
  const ruleNames = useMemo(() => {
    const names = {};
    for (const finding of logs.findings.values()) {
      names[finding.rule] = finding.textKey === 'log-custom' ? finding.params.name : t(`logRuleShort_${finding.rule}`);
    }
    for (const rule of logs.rules.custom) {
      names[`log-custom-${rule.id}`] = rule.name;
    }
    return names;
  }, [logs.findings, logs.rules, t]);

  // a paused view keeps the lines it had; the stream goes on underneath
  const shownVersion = frozen?.version ?? logs.version;
  const filterApp = onlyApp && !!logs.appId;
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const levelFrom = LOG_LEVELS.indexOf(minLevel);
    return logs.entries.filter((entry) => {
      if (frozen && entry.seq > frozen.seq) {
        return false;
      }
      if (entry.kind === 'marker') {
        return !ruleFilter && !needle;
      }
      if (filterApp && !entry.forApp) {
        return false;
      }
      if (LOG_LEVELS.indexOf(entry.level) < levelFrom) {
        return false;
      }
      if (ruleFilter && !entry.hits?.includes(ruleFilter)) {
        return false;
      }
      return !needle || entry.tag.toLowerCase().includes(needle) || entry.message.toLowerCase().includes(needle);
    });
    // the entry list grows in place: the version says when to look again
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [shownVersion, query, minLevel, ruleFilter, filterApp]);

  const levelCounts = useMemo(() => {
    const counts = Object.fromEntries(LOG_LEVELS.map((level) => [level, 0]));
    for (const entry of logs.entries) {
      if (entry.kind !== 'marker' && (!filterApp || entry.forApp)) {
        counts[entry.level]++;
      }
    }
    return counts;
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [logs.version, filterApp]);

  const selectedEntry = useMemo(
    () => (selected === null ? null : logs.entries.find((entry) => entry.seq === selected)),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [selected, logs.version],
  );

  const findings = useMemo(() => {
    const all = [...logs.findings.values()];
    return filterApp ? all.filter((finding) => finding.forApp) : all;
  }, [logs.findings, filterApp]);

  const togglePause = useCallback(
    () => setFrozen((current) => (current ? null : {version: logs.version, seq: logs.entries.at(-1)?.seq ?? 0})),
    [logs],
  );

  if (!backend.logs) {
    return <EmptyState tool="logs" icon={IconTerminal2} title={t('logsDesktopOnly')} />;
  }
  if (!running) {
    return (
      <EmptyState
        tool="logs"
        icon={IconTerminal2}
        title={t('logsNoDeviceTitle')}
        text={t('logsNoDevice')}
        steps={[t('logsStepConnect'), t('logsStepPick'), t('logsStepRules')]}
        actions={
          <Button type="primary" icon={<IconDeviceMobile size={16} />} onClick={() => navigate('/')}>
            {t('logsToDevices')}
          </Button>
        }
      />
    );
  }

  const status = logs.status;
  const appProcess = logs.processes.at(-1);

  return (
    <div className={styles.tool}>
      <div className={styles.toolbar}>
        <button
          className={`${styles.appToggle} ${filterApp ? styles.appToggleOn : ''}`}
          aria-pressed={filterApp}
          disabled={!logs.appId}
          onClick={() => setOnlyApp(!onlyApp)}
        >
          <Switch size="small" checked={filterApp} disabled={!logs.appId} tabIndex={-1} />
          <span>{t('logsOnlyApp')}</span>
          <span className={styles.mono}>{logs.appId ?? t('logsNoApp')}</span>
          {appProcess && !appProcess.endedAt && <span className={styles.dim}>pid {appProcess.pid}</span>}
        </button>
        <div className={styles.levels} role="group" aria-label={t('logsMinLevel')}>
          {LOG_LEVELS.map((level) => (
            <Tooltip key={level} title={t('logsLevelFrom', {level: LEVEL_NAMES[level]})}>
              <button
                aria-pressed={minLevel === level}
                className={`${styles.levelButton} ${minLevel === level ? styles.levelButtonOn : ''}`}
                onClick={() => setMinLevel(level)}
              >
                <span className={styles[`levelText_${level}`]}>{level}</span>
                <span className={styles.dim}>{levelCounts[level]}</span>
              </button>
            </Tooltip>
          ))}
        </div>
        <Input
          allowClear
          prefix={<IconSearch size={14} />}
          placeholder={t('logsSearch')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={styles.search}
        />
        <div className={styles.spacer} />
        <span className={`${styles.status} ${styles[`status_${status.state}`] ?? ''}`}>
          <span className={styles.statusDot} />
          {t(`logsStatus_${status.state}`, {count: logs.entries.length})}
        </span>
        <Tooltip title={frozen === null ? t('logsPause') : t('logsResume')}>
          <Button
            aria-label={frozen === null ? t('logsPause') : t('logsResume')}
            icon={frozen === null ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
            onClick={togglePause}
          />
        </Tooltip>
        <Tooltip title={t('logsClear')}>
          <Button aria-label={t('logsClear')} icon={<IconTrash size={16} />} onClick={() => clearLogs()} />
        </Tooltip>
        <Tooltip title={t('logsSave')}>
          <Button
            aria-label={t('logsSave')}
            icon={<IconDeviceFloppy size={16} />}
            onClick={() => backend.logs.save(`${logs.appId ?? device.name}.log`)}
          />
        </Tooltip>
      </div>

      {status.state === 'failed' && (
        <Alert
          className={styles.banner}
          type="error"
          showIcon
          title={t(`logsFail_${status.reason}`, {defaultValue: t('logsFail_failed')})}
          description={status.error}
          action={
            <Button
              size="small"
              icon={<IconRefresh size={14} />}
              onClick={() => startLogs(device, appId, {restart: true})}
            >
              {t('logsRestart')}
            </Button>
          }
        />
      )}

      <div className={styles.body}>
        <section className={styles.stream} aria-label={t('logsStream')}>
          <LogList
            rows={rows}
            selected={selected}
            onSelect={setSelected}
            follow={follow && frozen === null}
            onFollowChange={setFollow}
            ruleNames={ruleNames}
          />
          {(!follow || frozen !== null) && (
            <Button
              className={styles.toBottom}
              shape="round"
              icon={<IconArrowDown size={14} />}
              onClick={() => {
                setFrozen(null);
                setFollow(true);
              }}
            >
              {t('logsToLatest')}
            </Button>
          )}
          {selectedEntry && (
            <div className={styles.detail}>
              <div className={styles.detailHead}>
                <span className={`${styles.level} ${styles[`level_${selectedEntry.level}`]}`}>
                  {selectedEntry.level}
                </span>
                <span className={styles.mono}>
                  {selectedEntry.date} {selectedEntry.time} · pid {selectedEntry.pid} · {selectedEntry.tag}
                </span>
                <div className={styles.spacer} />
                <Button size="small" onClick={() => navigator.clipboard.writeText(selectedEntry.message)}>
                  {t('logsCopy')}
                </Button>
                <Button size="small" type="text" onClick={() => setSelected(null)}>
                  {t('logsClose')}
                </Button>
              </div>
              <pre className={styles.detailText}>{selectedEntry.message}</pre>
            </div>
          )}
        </section>

        <aside className={styles.side} aria-label={t('logsRules')}>
          <div className={styles.sideBlock}>
            <h2 className={styles.sideTitle}>{t('logsFired')}</h2>
            <LogFindings findings={findings} ruleFilter={ruleFilter} onRuleFilter={setRuleFilter} />
          </div>
          {logs.appId && (
            <div className={styles.sideBlock}>
              <h2 className={styles.sideTitle}>{t('logsProcesses')}</h2>
              {logs.processes.length ? (
                logs.processes.map((process) => (
                  <div key={process.pid} className={styles.process}>
                    <span className={styles.mono}>pid {process.pid}</span>
                    <span className={process.endedAt ? styles.ended : styles.alive}>
                      {process.endedAt
                        ? t('logsProcessEndedAt', {time: process.endedAt === 'ended' ? '' : process.endedAt})
                        : t('logsProcessAlive')}
                    </span>
                  </div>
                ))
              ) : (
                <div className={styles.quiet}>{t('logsAppNotRunning')}</div>
              )}
            </div>
          )}
          <div className={styles.sideBlock}>
            <h2 className={styles.sideTitle}>{t('logsCustomRules')}</h2>
            <CustomRules rules={logs.rules} />
          </div>
          <div className={styles.note}>{t('logsFullStreamNote')}</div>
        </aside>
      </div>
    </div>
  );
};

export default LogsTool;
