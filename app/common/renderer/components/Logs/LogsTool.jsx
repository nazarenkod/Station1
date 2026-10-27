import {
  IconArrowDown,
  IconBrain,
  IconTarget,
  IconCopy,
  IconDeviceFloppy,
  IconDeviceMobile,
  IconEyeOff,
  IconFilter,
  IconLayoutSidebarRight,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTerminal2,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import {Alert, App, Button, Input, Segmented, Select, Switch, Tooltip} from 'antd';
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {SEVERITIES, severityRank} from '../../../shared/findings/findings.js';
import {LOG_LEVELS} from '../../../shared/findings/log-rules.js';
import {activeDevice, isDeviceRunning} from '../../actions/Workstation.js';
import {askAbout} from '../../lib/agent/agent-store.js';
import {logPick} from '../../lib/agent/picks.js';
import {clearFocus, setPick, useFocus} from '../../lib/agent/selection.js';
import {openGoalForm} from '../../lib/goals/goal-form.js';
import {adviceText, useProjectAdvice} from '../../lib/settings/project-advice.js';
import {logsView} from '../../lib/settings/views.js';
import {backend} from '../../polyfills.js';
import {SeverityTag} from '../Findings/FindingsList.jsx';
import EmptyState from '../Workstation/EmptyState.jsx';
import {highlightParts, isEmptyQuery, matchesEntry, parseQuery, patternFromLine} from './log-filter.js';
import {clearLogs, saveRules, startLogs, useLogs} from './logs-store.js';

import styles from './Logs.module.css';

const ROW_HEIGHT = 24;
const OVERSCAN = 20;
// the levels people pick from: everything, info and up, warnings and up, errors
const LEVEL_PRESETS = ['V', 'I', 'W', 'E'];

// whether the side panel is open, for when the tool is opened again in this run of the app
const memory = {sideOpen: true};

/**
 * State the tool keeps between visits: a choice made once stays made.
 */
function useRemembered(key) {
  const [value, setValue] = useState(memory[key]);
  const remember = useCallback(
    (next) => {
      memory[key] = next;
      setValue(next);
    },
    [key],
  );
  return [value, remember];
}

// a setter of a set kept as a list: takes a set, or a function of the current set
const setOfList = (key) => (next) =>
  logsView.update((current) => ({
    [key]: [...(typeof next === 'function' ? next(new Set(current[key])) : next)],
  }));
const setScope = (scope) => logsView.update({scope});
const setMinLevel = (minLevel) => logsView.update({minLevel});
const setQuery = (query) => logsView.update({query});
const setTags = setOfList('tags');
const setHiddenTags = setOfList('hiddenTags');

const typingIn = (target) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable;

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
const LogList = ({rows, selected, onSelect, follow, onFollowChange, ruleNames, query, onOnlyTag, onHideTag}) => {
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
              <div
                key={entry.seq}
                role="button"
                tabIndex={-1}
                className={`${styles.row} ${entry.hits?.length ? styles.rowHit : ''} ${selected === entry.seq ? styles.rowSelected : ''} ${entry.app ? '' : styles.rowSystem}`}
                style={{height: ROW_HEIGHT}}
                onClick={() => onSelect(entry.seq)}
                onKeyDown={(e) => e.key === 'Enter' && onSelect(entry.seq)}
              >
                <span className={styles.time}>{entry.time}</span>
                <span className={styles.pid}>{entry.pid}</span>
                <span className={`${styles.level} ${styles[`level_${entry.level}`]}`}>{entry.level}</span>
                <span className={styles.tag}>{entry.tag}</span>
                <span className={`${styles.message} ${styles[`msg_${entry.level}`] ?? ''}`}>
                  {highlightParts(firstLine(entry.message), query).map(([text, found], i) =>
                    found ? (
                      // the parts of one line never move: their order is their identity
                      // oxlint-disable-next-line react/no-array-index-key
                      <mark key={i} className={styles.found}>
                        {text}
                      </mark>
                    ) : (
                      text
                    ),
                  )}
                </span>
                {extraLines(entry.message) > 0 && <span className={styles.more}>+{extraLines(entry.message)}</span>}
                {entry.hits?.map((rule) => (
                  <span key={rule} className={styles.hit}>
                    {ruleNames[rule] ?? rule}
                  </span>
                ))}
                <span className={styles.rowActions}>
                  <Tooltip title={t('logsOnlyTag', {tag: entry.tag})}>
                    <button
                      type="button"
                      className={styles.rowAction}
                      aria-label={t('logsOnlyTag', {tag: entry.tag})}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOnlyTag(entry.tag);
                      }}
                    >
                      <IconFilter size={13} />
                    </button>
                  </Tooltip>
                  <Tooltip title={t('logsHideTag', {tag: entry.tag})}>
                    <button
                      type="button"
                      className={styles.rowAction}
                      aria-label={t('logsHideTag', {tag: entry.tag})}
                      onClick={(e) => {
                        e.stopPropagation();
                        onHideTag(entry.tag);
                      }}
                    >
                      <IconEyeOff size={13} />
                    </button>
                  </Tooltip>
                </span>
              </div>
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
export const NEW_RULE_DRAFT = NEW_RULE;

const CustomRules = ({rules, draft, setDraft}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();

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
  const advice = useProjectAdvice();
  const navigate = useNavigate();
  const workstation = useSelector((state) => state.workstation);
  const device = activeDevice(workstation);
  const appId = workstation.app?.id ?? null;
  const logs = useLogs();
  const searchRef = useRef(null);

  // the filters stay with the profile, across restarts; one subscription for all of them
  const saved = logsView.use();
  const {scope, minLevel, query: queryText} = saved;
  const tags = useMemo(() => new Set(saved.tags), [saved.tags]);
  const hiddenTags = useMemo(() => new Set(saved.hiddenTags), [saved.hiddenTags]);
  const [ruleFilter, setRuleFilter] = useState(null);
  const [follow, setFollow] = useState(true);
  const [frozen, setFrozen] = useState(null);
  const [selected, setSelected] = useState(null);
  const [sideOpen, setSideOpen] = useRemembered('sideOpen');
  const [draft, setDraft] = useState(null);

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

  // without an app there is only the whole device to show
  const effectiveScope = logs.appId ? scope : 'device';
  const query = useMemo(() => parseQuery(queryText), [queryText]);

  // a paused view keeps the lines it had; the stream goes on underneath
  const shownVersion = frozen?.version ?? logs.version;
  const rows = useMemo(() => {
    const filters = {scope: effectiveScope, minLevel, tags, hiddenTags, rule: ruleFilter, query};
    const searching = !!ruleFilter || !isEmptyQuery(query) || tags.size > 0;
    return logs.entries.filter((entry) => {
      if (frozen && entry.seq > frozen.seq) {
        return false;
      }
      if (entry.kind === 'marker') {
        return !searching;
      }
      return matchesEntry(entry, filters);
    });
    // the entry list grows in place: the version says when to look again
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [shownVersion, query, minLevel, ruleFilter, effectiveScope, tags, hiddenTags]);

  const levelCounts = useMemo(() => {
    const counts = Object.fromEntries(LOG_LEVELS.map((level) => [level, 0]));
    for (const entry of logs.entries) {
      if (entry.kind !== 'marker' && (effectiveScope === 'device' || entry.forApp)) {
        counts[entry.level]++;
      }
    }
    return counts;
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [logs.version, effectiveScope]);

  // the evidence of a goal opens here
  const focus = useFocus();
  useEffect(() => {
    if (focus?.kind === 'log') {
      setSelected(Number(focus.id));
      clearFocus();
    }
  }, [focus]);
  // the line picked here goes with the next message to the agent
  useEffect(() => {
    const entry = selected === null ? null : logs.entries.find((one) => one.seq === selected);
    setPick('log', entry ? logPick(entry) : null);
  }, [selected, logs.entries]);
  const selectedEntry = useMemo(
    () => (selected === null ? null : logs.entries.find((entry) => entry.seq === selected)),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [selected, logs.version],
  );

  const findings = useMemo(() => {
    const all = [...logs.findings.values()];
    return effectiveScope === 'app' ? all.filter((finding) => finding.forApp) : all;
  }, [logs.findings, effectiveScope]);

  const togglePause = useCallback(
    () => setFrozen((current) => (current ? null : {version: logs.version, seq: logs.entries.at(-1)?.seq ?? 0})),
    [logs],
  );

  const onlyTag = (tag) => {
    setTags(new Set([tag]));
    setHiddenTags((current) => new Set([...current].filter((t2) => t2 !== tag)));
  };
  const hideTag = (tag) => {
    setHiddenTags((current) => new Set([...current, tag]));
    setTags((current) => new Set([...current].filter((t2) => t2 !== tag)));
    if (selectedEntry?.tag === tag) {
      setSelected(null);
    }
  };
  const resetFilters = () => {
    setTags(new Set());
    setHiddenTags(new Set());
    setRuleFilter(null);
    setQuery('');
    setMinLevel('V');
  };
  const ruleFromLine = (entry) => {
    setSideOpen(true);
    setDraft({
      ...NEW_RULE_DRAFT,
      name: entry.tag,
      tag: entry.tag,
      pattern: patternFromLine(entry.message),
      scope: entry.forApp ? 'app' : 'device',
    });
  };

  // keys that make the log quick: / to search, Esc to step back, space to pause
  const onKeyDown = (event) => {
    if (event.key === '/' && !typingIn(event.target)) {
      event.preventDefault();
      searchRef.current?.focus();
    } else if (event.key === 'Escape') {
      if (selected !== null) {
        setSelected(null);
      } else if (typingIn(event.target) && queryText) {
        setQuery('');
      } else {
        resetFilters();
        event.target.blur?.();
      }
    } else if (event.key === ' ' && !typingIn(event.target)) {
      event.preventDefault();
      togglePause();
    }
  };

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
  const appAlive = appProcess && !appProcess.endedAt;
  const shortApp = logs.appId?.split('.').slice(-2).join('.');
  const chips = [
    ...[...tags].map((tag) => ({key: `tag-${tag}`, text: t('logsChipTag', {tag}), clear: () => setTags(new Set())})),
    ...[...hiddenTags].map((tag) => ({
      key: `hide-${tag}`,
      text: t('logsChipHidden', {tag}),
      off: true,
      clear: () => setHiddenTags((current) => new Set([...current].filter((t2) => t2 !== tag))),
    })),
    ...(ruleFilter
      ? [
          {
            key: 'rule',
            text: t('logsChipRule', {rule: ruleNames[ruleFilter] ?? ruleFilter}),
            clear: () => setRuleFilter(null),
          },
        ]
      : []),
  ];
  const filtered = chips.length > 0 || !isEmptyQuery(query) || minLevel !== 'V';
  const firedRules = new Set(findings.map((finding) => finding.rule)).size;

  return (
    // the keys work anywhere in the tool
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className={styles.tool} onKeyDown={onKeyDown}>
      <div className={styles.toolbar}>
        <Segmented
          value={effectiveScope}
          onChange={setScope}
          options={[
            {
              value: 'app',
              disabled: !logs.appId,
              label: (
                <Tooltip
                  title={
                    logs.appId
                      ? t('logsScopeAppHint', {app: logs.appId})
                      : advice
                        ? adviceText(t, advice)
                        : t('logsScopeNoAppHint')
                  }
                >
                  <span className={styles.scopeOption}>{logs.appId ? shortApp : t('logsScopeNoApp')}</span>
                </Tooltip>
              ),
            },
            {value: 'device', label: <span className={styles.scopeOption}>{t('logsScopeDevice')}</span>},
          ]}
        />
        <Segmented
          value={minLevel}
          onChange={setMinLevel}
          options={LEVEL_PRESETS.map((level) => {
            const count = level === 'W' ? levelCounts.W : level === 'E' ? levelCounts.E + levelCounts.F : 0;
            return {
              value: level,
              label: (
                <span className={styles.levelOption}>
                  {t(`logsLevel_${level}`)}
                  {count > 0 && (
                    <span className={`${styles.levelCount} ${styles[`levelCount_${level}`]}`}>{count}</span>
                  )}
                </span>
              ),
            };
          })}
        />
        <Input
          ref={searchRef}
          allowClear
          prefix={<IconSearch size={14} />}
          suffix={!queryText && <kbd className={styles.kbd}>/</kbd>}
          placeholder={t('logsSearchHint')}
          value={queryText}
          status={query.error ? 'error' : undefined}
          onChange={(e) => setQuery(e.target.value)}
          className={styles.search}
        />
        <div className={styles.spacer} />
        <Tooltip title={frozen === null ? t('logsPause') : t('logsResume')}>
          <Button
            type={frozen === null ? 'default' : 'primary'}
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
        <Button
          type={sideOpen ? 'primary' : 'default'}
          ghost={sideOpen}
          icon={<IconLayoutSidebarRight size={16} />}
          onClick={() => setSideOpen(!sideOpen)}
        >
          {t('logsRulesToggle')}
          {firedRules > 0 && <span className={styles.rulesCount}>{firedRules}</span>}
        </Button>
      </div>

      {(chips.length > 0 || query.error) && (
        <div className={styles.chips}>
          {chips.map((chip) => (
            <span key={chip.key} className={`${styles.chip} ${chip.off ? styles.chipOff : ''}`}>
              {chip.text}
              <button
                type="button"
                className={styles.chipClear}
                aria-label={t('logsChipClear')}
                onClick={() => chip.clear()}
              >
                <IconX size={12} />
              </button>
            </span>
          ))}
          {query.error && <span className={styles.errorText}>{t('logsSearchError', {error: query.error})}</span>}
          {filtered && (
            <Button size="small" type="link" onClick={resetFilters}>
              {t('logsResetFilters')}
            </Button>
          )}
        </div>
      )}

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
            query={query}
            onOnlyTag={onlyTag}
            onHideTag={hideTag}
          />
          {rows.length === 0 && logs.entries.length > 0 && (
            <div className={styles.noRows}>
              {t('logsNoRows')}
              {filtered && (
                <Button size="small" onClick={resetFilters}>
                  {t('logsResetFilters')}
                </Button>
              )}
            </div>
          )}
          {(!follow || frozen !== null) && (
            <Button
              className={`${styles.toBottom} ${selectedEntry ? styles.toBottomRaised : ''}`}
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
                <Button size="small" icon={<IconFilter size={14} />} onClick={() => onlyTag(selectedEntry.tag)}>
                  {t('logsOnlyThisTag')}
                </Button>
                <Button size="small" icon={<IconEyeOff size={14} />} onClick={() => hideTag(selectedEntry.tag)}>
                  {t('logsHideThisTag')}
                </Button>
                <Button size="small" icon={<IconPlus size={14} />} onClick={() => ruleFromLine(selectedEntry)}>
                  {t('logsRuleFromLine')}
                </Button>
                <Tooltip title={t('goalMake')}>
                  <Button
                    size="small"
                    aria-label={t('goalMake')}
                    icon={<IconTarget size={14} />}
                    onClick={() =>
                      openGoalForm({
                        type: 'log',
                        source: 'manual',
                        title: String(selectedEntry.message).split('\n')[0].slice(0, 80),
                        params: {
                          pattern: String(selectedEntry.message)
                            .split('\n')[0]
                            .slice(0, 60)
                            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                          tag: selectedEntry.tag,
                          mode: 'seen',
                        },
                      })
                    }
                  />
                </Tooltip>
                <Tooltip title={t('agentAskAbout')}>
                  <Button
                    size="small"
                    aria-label={t('agentAskAbout')}
                    icon={<IconBrain size={14} />}
                    onClick={() => askAbout({kind: 'log', ...logPick(selectedEntry)})}
                  />
                </Tooltip>
                <Tooltip title={t('logsCopy')}>
                  <Button
                    size="small"
                    aria-label={t('logsCopy')}
                    icon={<IconCopy size={14} />}
                    onClick={() => navigator.clipboard.writeText(selectedEntry.message)}
                  />
                </Tooltip>
                <Tooltip title={t('logsClose')}>
                  <Button
                    size="small"
                    type="text"
                    aria-label={t('logsClose')}
                    icon={<IconX size={14} />}
                    onClick={() => setSelected(null)}
                  />
                </Tooltip>
              </div>
              <pre className={styles.detailText}>{selectedEntry.message}</pre>
            </div>
          )}
        </section>

        {sideOpen && (
          <aside className={styles.side} aria-label={t('logsRules')}>
            <div className={styles.sideBlock}>
              <h2 className={styles.sideTitle}>{t('logsFired')}</h2>
              <LogFindings findings={findings} ruleFilter={ruleFilter} onRuleFilter={setRuleFilter} />
            </div>
            <div className={styles.sideBlock}>
              <h2 className={styles.sideTitle}>{t('logsCustomRules')}</h2>
              <CustomRules rules={logs.rules} draft={draft} setDraft={setDraft} />
            </div>
            <div className={styles.note}>{t('logsFullStreamNote')}</div>
          </aside>
        )}
      </div>

      <footer className={styles.statusBar}>
        <span className={`${styles.status} ${styles[`status_${status.state}`] ?? ''}`}>
          <span className={styles.statusDot} />
          {frozen ? t('logsPaused') : t(`logsStatus_${status.state}`, {count: logs.entries.length})}
        </span>
        <span className={styles.dim}>{t('logsShown', {count: rows.length})}</span>
        <span className={styles.statusApp}>
          {!logs.appId ? (
            t('logsAppNone')
          ) : (
            <>
              <span className={`vi-dot ${appAlive ? 'vi-tone-ok' : 'vi-tone-off'}`} />
              <span className={styles.mono}>{logs.appId}</span>
              {appAlive ? t('logsAppRunning', {pid: appProcess.pid}) : t('logsAppNotRunning')}
            </>
          )}
        </span>
        <span className={styles.spacer} />
        <span className={styles.keys}>{t('logsKeys')}</span>
      </footer>
    </div>
  );
};

export default LogsTool;
