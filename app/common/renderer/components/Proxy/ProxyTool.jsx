import {
  IconAdjustmentsHorizontal,
  IconArrowsExchange,
  IconChevronRight,
  IconDots,
  IconDownload,
  IconEyeOff,
  IconFilter,
  IconList,
  IconWorld,
  IconX,
  IconPlayerPause,
  IconPower,
  IconSearch,
  IconShieldX,
  IconTrash,
  IconWand,
} from '@tabler/icons-react';
import {Alert, Button, Dropdown, Input, Segmented, Spin, Splitter, Tooltip} from 'antd';
import {Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';

import {activeDevice, isDeviceRunning} from '../../actions/Workstation.js';
import {backend} from '../../polyfills.js';
import EmptyState from '../Workstation/EmptyState.jsx';
import ConnectDrawer from './ConnectDrawer.jsx';
import {
  FILTERS,
  formatDuration,
  formatSize,
  groupByHost,
  hostAndPath,
  matchesFilter,
  statusTone,
} from './exchange-utils.js';
import ExchangeDetail from './ExchangeDetail.jsx';
import {clearTraffic, resumePause, saveProxyConfig, startProxy, stopProxy, useProxy} from './proxy-store.js';
import RulesDrawer from './RulesDrawer.jsx';
import SetUpDevice from './SetUpDevice.jsx';

import styles from './Proxy.module.css';

const ROW_HEIGHT = 30;
const OVERSCAN = 15;
const FLAG_ORDER = ['paused', 'held', 'error', 'slow', 'dupe', 'contract', 'mock', 'replay', 'ignored'];

// how the traffic was last shown, for when the tool is opened again in this run
const memory = {view: 'list', expanded: new Set(), hiddenHosts: new Set()};

/**
 * A domain's line in the grouped list: open or closed, with what its
 * requests add up to, and its own quick filters.
 */
const HostRow = ({group, open, onToggle, onOnly, onHide}) => {
  const {t} = useTranslation();
  return (
    <div
      role="button"
      tabIndex={-1}
      style={{height: ROW_HEIGHT}}
      className={`${styles.row} ${styles.hostRow}`}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={(e) => e.key === 'Enter' && onToggle()}
    >
      <IconChevronRight size={14} className={`${styles.hostChevron} ${open ? styles.hostChevronOpen : ''}`} />
      <span className={styles.hostName}>{group.host || t('proxyNoHost')}</span>
      <span className={styles.hostStat}>{t('proxyHostRequests', {count: group.count})}</span>
      {group.errors > 0 && <span className={`${styles.flag} ${styles.flag_error}`}>{group.errors}</span>}
      {group.slow > 0 && <span className={`${styles.flag} ${styles.flag_slow}`}>{group.slow}</span>}
      <span className={styles.hostStat}>{group.avgMs ? `⌀ ${formatDuration(group.avgMs)}` : ''}</span>
      <span className={styles.hostStat}>{formatSize(group.size)}</span>
      <span className={styles.hostActions}>
        <Tooltip title={t('proxyOnlyHost')}>
          <button
            type="button"
            className={styles.hostAction}
            aria-label={t('proxyOnlyHost')}
            onClick={(e) => {
              e.stopPropagation();
              onOnly();
            }}
          >
            <IconFilter size={13} />
          </button>
        </Tooltip>
        <Tooltip title={t('proxyHideHost')}>
          <button
            type="button"
            className={styles.hostAction}
            aria-label={t('proxyHideHost')}
            onClick={(e) => {
              e.stopPropagation();
              onHide();
            }}
          >
            <IconEyeOff size={13} />
          </button>
        </Tooltip>
      </span>
    </div>
  );
};

/**
 * The captured requests, drawn only where the viewport is.
 */
const ExchangeList = ({rows, selected, onSelect, maxDuration, hostRow}) => {
  const {t} = useTranslation();
  const scroller = useRef(null);
  const [view, setView] = useState({top: 0, height: 600});
  const [follow, setFollow] = useState(true);

  useLayoutEffect(() => {
    if (follow && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [rows, follow]);

  useEffect(() => {
    const el = scroller.current;
    const observer = new ResizeObserver(() => setView((v) => ({...v, height: el.clientHeight})));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // a row picked from the keyboard scrolls into view
  useEffect(() => {
    const el = scroller.current;
    const index = rows.findIndex((x) => x.id === selected);
    if (!el || index < 0) {
      return;
    }
    const top = index * ROW_HEIGHT;
    if (top < el.scrollTop) {
      el.scrollTop = top;
    } else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    }
    // only when the pick changes, not when rows arrive
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const first = Math.max(0, Math.floor(view.top / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((view.top + view.height) / ROW_HEIGHT) + OVERSCAN);

  return (
    <div className={styles.table}>
      <div className={styles.headRow}>
        <span className={styles.cTime}>{t('proxyColTime')}</span>
        <span className={styles.cMethod}>{t('proxyMethod')}</span>
        <span className={styles.cStatus}>{t('proxyColStatus')}</span>
        <span className={styles.cUrl}>{t('proxyColUrl')}</span>
        <span className={styles.cDuration}>{t('proxyColDuration')}</span>
        <span className={styles.cSize}>{t('proxyColSize')}</span>
        <span className={styles.cFlags}>{t('proxyColFlags')}</span>
      </div>
      <div
        className={styles.scroller}
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          setView({top: el.scrollTop, height: el.clientHeight});
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < ROW_HEIGHT * 2);
        }}
      >
        <div style={{height: rows.length * ROW_HEIGHT, position: 'relative'}}>
          <div style={{position: 'absolute', top: first * ROW_HEIGHT, left: 0, right: 0}}>
            {rows.slice(first, last).map((x) => {
              if (x.kind === 'host') {
                return <Fragment key={`host-${x.host}`}>{hostRow(x)}</Fragment>;
              }
              const {host, path} = hostAndPath(x.url);
              const tone = statusTone(x);
              const share = x.durationMs ? Math.max(2, Math.min(100, (x.durationMs / maxDuration) * 100)) : 0;
              return (
                <button
                  key={x.id}
                  style={{height: ROW_HEIGHT}}
                  className={`${styles.row} ${selected === x.id ? styles.rowSelected : ''}`}
                  onClick={() => onSelect(x.id)}
                >
                  <span className={`${styles.cTime} ${styles.dim}`}>{new Date(x.startedAt).toLocaleTimeString()}</span>
                  <span className={`${styles.cMethod} ${styles.method} ${styles[`method_${x.method}`] ?? ''}`}>
                    {x.method}
                  </span>
                  <span className={`${styles.cStatus} ${styles[`text_${tone}`]}`}>
                    {tone === 'paused' ? '⏸' : x.status === null ? '…' : x.status || 'ERR'}
                  </span>
                  <span className={styles.cUrl}>
                    <span className={styles.dim}>{host}</span>
                    <span className={styles.path}>{path}</span>
                  </span>
                  <span className={styles.cDuration}>
                    <span className={styles.bar}>
                      <span
                        className={`${styles.barFill} ${x.flags?.includes('slow') ? styles.barSlow : ''}`}
                        style={{width: `${share}%`}}
                      />
                    </span>
                    <span className={`${styles.durationText} ${x.flags?.includes('slow') ? styles.text_slow : ''}`}>
                      {formatDuration(x.durationMs)}
                    </span>
                  </span>
                  <span className={`${styles.cSize} ${styles.dim}`}>{formatSize(x.responseSize)}</span>
                  <span className={styles.cFlags}>
                    {FLAG_ORDER.filter((flag) => x.flags?.includes(flag)).map((flag) => (
                      <span key={flag} className={`${styles.flag} ${styles[`flag_${flag}`]}`}>
                        {t(`proxyFlag_${flag}`)}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * The Proxy tool: the device's HTTP(S) traffic, what the rules say about it,
 * rewrite rules and breakpoints.
 */
const ProxyTool = () => {
  const {t} = useTranslation();
  const proxy = useProxy();
  const workstation = useSelector((state) => state.workstation);
  const device = activeDevice(workstation);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState(memory.view);
  const [expanded, setExpanded] = useState(memory.expanded);
  const [onlyHosts, setOnlyHosts] = useState(() => new Set());
  const [hiddenHosts, setHiddenHosts] = useState(memory.hiddenHosts);
  const [selected, setSelected] = useState(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const searchRef = useRef(null);
  const toolRef = useRef(null);

  useEffect(() => {
    startProxy();
  }, []);

  // keys work as soon as the tool opens
  useEffect(() => {
    toolRef.current?.focus({preventScroll: true});
  }, [proxy.started]);

  const all = useMemo(
    () => proxy.order.map((id) => proxy.byId.get(id)).filter(Boolean),
    // the lists change in place: the version says when
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [proxy.version],
  );
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f, all.filter((x) => matchesFilter(x, f)).length])),
    [all],
  );
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all.filter((x) => {
      const {host} = hostAndPath(x.url);
      if ((onlyHosts.size && !onlyHosts.has(host)) || hiddenHosts.has(host)) {
        return false;
      }
      return (
        matchesFilter(x, filter) &&
        (!needle ||
          x.url.toLowerCase().includes(needle) ||
          x.method.toLowerCase() === needle ||
          String(x.status) === needle)
      );
    });
  }, [all, filter, query, onlyHosts, hiddenHosts]);
  // by domain: each domain's line, and its requests under it while it is open
  const groups = useMemo(() => (view === 'hosts' ? groupByHost(rows) : []), [view, rows]);
  const items = useMemo(
    () =>
      view === 'hosts'
        ? groups.flatMap((group) => [{kind: 'host', ...group}, ...(expanded.has(group.host) ? group.exchanges : [])])
        : rows,
    [view, groups, rows, expanded],
  );
  const visibleRows = useMemo(() => items.filter((item) => item.kind !== 'host'), [items]);
  // what the rule editor suggests instead of typing: every path seen so far
  const knownUrls = useMemo(() => {
    const seen = new Set();
    for (const x of all) {
      try {
        const url = new URL(x.url);
        seen.add(`${url.origin}${url.pathname}*`);
      } catch {
        // not a URL: nothing to suggest
      }
    }
    return [...seen].slice(-300).reverse();
  }, [all]);
  const activeRules = proxy.config.mockRules.filter((rule) => rule.enabled !== false).length;
  const maxDuration = useMemo(() => Math.max(1000, ...all.map((x) => x.durationMs ?? 0)), [all]);

  // a request that stops at a breakpoint comes to the front by itself
  const firstPause = proxy.pauses[0];
  useEffect(() => {
    if (firstPause) {
      setSelected(firstPause.exchangeId);
    }
  }, [firstPause]);

  const exchange = selected ? proxy.byId.get(selected) : null;
  const pause = exchange ? proxy.pauses.find((p) => p.exchangeId === exchange.id) : null;
  const mockRuleNames = useMemo(
    () => Object.fromEntries(proxy.config.mockRules.map((r) => [r.id, r.name])),
    [proxy.config.mockRules],
  );
  const tlsFailures = proxy.status.tlsFailures ?? [];

  if (!backend.proxy) {
    return <EmptyState tool="proxy" icon={IconArrowsExchange} title={t('proxyDesktopOnly')} />;
  }
  if (proxy.error) {
    return (
      <div className={styles.empty}>
        <Alert
          type="error"
          showIcon
          title={t('proxyStartFailed')}
          description={proxy.error}
          action={<Button onClick={() => startProxy()}>{t('logsRestart')}</Button>}
        />
      </div>
    );
  }
  if (!proxy.started) {
    return (
      <div className={styles.empty}>
        <Spin />
      </div>
    );
  }

  const running = proxy.status.running;

  // ↑ ↓ (or J K) walk the list, Esc closes the details, / goes to the search
  const onKeyDown = (event) => {
    const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable;
    if (event.key === '/' && !inField) {
      event.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (inField || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const step = {ArrowDown: 1, j: 1, ArrowUp: -1, k: -1}[event.key];
    if (step && visibleRows.length) {
      event.preventDefault();
      const index = visibleRows.findIndex((x) => x.id === selected);
      const next =
        index < 0
          ? step > 0
            ? 0
            : visibleRows.length - 1
          : Math.min(visibleRows.length - 1, Math.max(0, index + step));
      setSelected(visibleRows[next].id);
    } else if (event.key === 'Escape' && selected) {
      setSelected(null);
    }
  };

  const chooseView = (value) => {
    memory.view = value;
    setView(value);
  };
  const toggleHost = (host) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(host)) {
        next.add(host);
      }
      return (memory.expanded = next);
    });
  const onlyHost = (host) => {
    setOnlyHosts(new Set([host]));
    setExpanded((current) => (memory.expanded = new Set([...current, host])));
  };
  const hideHost = (host) => setHiddenHosts((current) => (memory.hiddenHosts = new Set([...current, host])));
  const unhideHost = (host) =>
    setHiddenHosts((current) => (memory.hiddenHosts = new Set([...current].filter((h) => h !== host))));
  const hostChips = [
    ...[...onlyHosts].map((host) => ({key: `only-${host}`, host, off: false, clear: () => setOnlyHosts(new Set())})),
    ...[...hiddenHosts].map((host) => ({key: `hide-${host}`, host, off: true, clear: () => unhideHost(host)})),
  ];

  return (
    <div className={styles.tool} ref={toolRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className={styles.toolbar}>
        <Input
          ref={searchRef}
          allowClear
          prefix={<IconSearch size={14} />}
          suffix={<kbd>/</kbd>}
          placeholder={t('proxySearch')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={styles.search}
        />
        <Segmented
          value={view}
          onChange={chooseView}
          options={[
            {
              value: 'list',
              label: (
                <Tooltip title={t('proxyViewList')}>
                  <IconList size={15} aria-label={t('proxyViewList')} className={styles.viewIcon} />
                </Tooltip>
              ),
            },
            {
              value: 'hosts',
              label: (
                <Tooltip title={t('proxyViewHosts')}>
                  <IconWorld size={15} aria-label={t('proxyViewHosts')} className={styles.viewIcon} />
                </Tooltip>
              ),
            },
          ]}
        />
        <div className={styles.chips} role="group" aria-label={t('findingsFilter')}>
          {FILTERS.map((key) =>
            key === 'all' || counts[key] ? (
              <button
                key={key}
                aria-pressed={filter === key}
                className={`${styles.chip} ${filter === key ? styles.chipOn : ''}`}
                onClick={() => setFilter(key)}
              >
                {key !== 'all' && <span className={`${styles.chipDot} ${styles[`dot_${key}`]}`} />}
                {t(`proxyFilter_${key}`)}
                <span className="vi-num">{counts[key]}</span>
              </button>
            ) : null,
          )}
        </div>
        <div className={styles.spacer} />
        <span className={`vi-pill ${running ? 'vi-tone-ok' : 'vi-tone-off'}`}>
          {running ? t('proxyRunningShort', {port: proxy.status.port}) : t('proxyStopped')}
        </span>
        <div className={styles.modes} role="group" aria-label={t('proxyModes')}>
          <Tooltip title={t('proxyBreakpointsHint')}>
            <button
              aria-pressed={proxy.config.breakpointsEnabled}
              className={`${styles.modeButton} ${proxy.config.breakpointsEnabled ? styles.modeOn : ''}`}
              onClick={() => saveProxyConfig({breakpointsEnabled: !proxy.config.breakpointsEnabled})}
            >
              <IconPlayerPause size={15} />
              {t('proxyBreakpoints')}
            </button>
          </Tooltip>
          <Tooltip title={t('proxyMocksHint')}>
            <button
              aria-pressed={proxy.config.mocksEnabled}
              className={`${styles.modeButton} ${proxy.config.mocksEnabled ? styles.modeOn : ''}`}
              onClick={() => saveProxyConfig({mocksEnabled: !proxy.config.mocksEnabled})}
            >
              <IconWand size={15} />
              {t('proxyMocks')}
            </button>
          </Tooltip>
        </div>
        <Button icon={<IconAdjustmentsHorizontal size={16} />} onClick={() => setRulesOpen(true)}>
          {t('proxyRules')}
          {activeRules > 0 && <span className={styles.countBadge}>{activeRules}</span>}
        </Button>
        <SetUpDevice
          device={isDeviceRunning(device) ? device : null}
          primary={false}
          onOpenDetails={() => setConnectOpen(true)}
        />
        <div className={styles.iconGroup}>
          <Tooltip title={t('logsClear')}>
            <Button
              type="text"
              aria-label={t('logsClear')}
              icon={<IconTrash size={16} />}
              onClick={() => {
                setSelected(null);
                clearTraffic();
              }}
            />
          </Tooltip>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {key: 'har', label: t('proxyExportHar'), icon: <IconDownload size={14} />},
                {key: 'power', label: running ? t('proxyStop') : t('proxyStart'), icon: <IconPower size={14} />},
              ],
              onClick: async ({key}) => {
                if (key === 'har') {
                  backend.proxy.exportHar(
                    rows.map((x) => x.id),
                    'traffic.har',
                  );
                } else if (running) {
                  await stopProxy();
                } else {
                  await backend.proxy.start({port: proxy.config.port});
                }
              },
            }}
          >
            <Button type="text" aria-label={t('proxyMore')} icon={<IconDots size={16} />} />
          </Dropdown>
        </div>
      </div>

      {hostChips.length > 0 && (
        <div className={styles.hostChips}>
          {hostChips.map((chip) => (
            <span key={chip.key} className={`${styles.hostChip} ${chip.off ? styles.hostChipOff : ''}`}>
              {chip.off ? t('proxyChipHidden', {host: chip.host}) : t('proxyChipOnly', {host: chip.host})}
              <button
                type="button"
                className={styles.hostChipClear}
                aria-label={t('logsChipClear')}
                onClick={() => chip.clear()}
              >
                <IconX size={12} />
              </button>
            </span>
          ))}
          <Button
            size="small"
            type="link"
            onClick={() => {
              setOnlyHosts(new Set());
              setHiddenHosts((memory.hiddenHosts = new Set()));
            }}
          >
            {t('logsResetFilters')}
          </Button>
        </div>
      )}

      {tlsFailures.length > 0 && (
        <Alert
          className={styles.banner}
          type="warning"
          showIcon
          icon={<IconShieldX size={18} />}
          title={t('proxyTlsFailures', {count: tlsFailures.length})}
          description={tlsFailures
            .slice(0, 4)
            .map((f) => f.host)
            .join(', ')}
          action={
            <Button size="small" onClick={() => setConnectOpen(true)}>
              {t('proxyHowToTrust')}
            </Button>
          }
        />
      )}

      {proxy.pauses.length > 0 && (
        <div className={styles.pausedBanner} role="status">
          <IconPlayerPause size={16} />
          <span className={styles.pausedText}>{t('proxyPausedCount', {count: proxy.pauses.length})}</span>
          <Button
            size="small"
            type="primary"
            onClick={() => proxy.pauses.forEach((p) => resumePause(p.id, {action: 'release'}))}
          >
            {t('proxyReleaseAll')}
          </Button>
          <Button size="small" onClick={() => saveProxyConfig({breakpointsEnabled: false})}>
            {t('proxyBreakpointsOff')}
          </Button>
        </div>
      )}

      {all.length === 0 ? (
        <EmptyState
          tool="proxy"
          icon={IconArrowsExchange}
          title={t('proxyWaitingTitle')}
          text={isDeviceRunning(device) ? t('proxyWaitingText', {device: device.name}) : t('proxyWaitingNoDevice')}
          steps={[
            isDeviceRunning(device) ? t('proxyStepPicked', {device: device.name}) : t('proxyStepPick'),
            t('proxyStepConnect'),
            t('proxyStepOpenApp'),
          ]}
          actions={
            <SetUpDevice device={isDeviceRunning(device) ? device : null} onOpenDetails={() => setConnectOpen(true)} />
          }
        />
      ) : (
        <Splitter className={styles.body}>
          <Splitter.Panel min={420} className={styles.listPane}>
            <section className={styles.listSection} aria-label={t('proxyTraffic')}>
              <ExchangeList
                rows={items}
                selected={selected}
                onSelect={setSelected}
                maxDuration={maxDuration}
                hostRow={(group) => (
                  <HostRow
                    group={group}
                    open={expanded.has(group.host)}
                    onToggle={() => toggleHost(group.host)}
                    onOnly={() => onlyHost(group.host)}
                    onHide={() => hideHost(group.host)}
                  />
                )}
              />
              <div className={styles.keys} aria-hidden="true">
                <span>
                  <kbd>↑</kbd>
                  <kbd>↓</kbd> {t('proxyKeysMove')}
                </span>
                <span>
                  <kbd>Esc</kbd> {t('proxyKeysClose')}
                </span>
                <span>
                  <kbd>/</kbd> {t('proxyKeysSearch')}
                </span>
              </div>
            </section>
          </Splitter.Panel>
          {exchange && (
            <Splitter.Panel defaultSize="42%" min={360} max="70%" className={styles.detailPane}>
              <aside aria-label={t('proxyDetails')}>
                <ExchangeDetail
                  key={exchange.id}
                  exchange={exchange}
                  pause={pause}
                  mockRuleNames={mockRuleNames}
                  onClose={() => setSelected(null)}
                />
              </aside>
            </Splitter.Panel>
          )}
        </Splitter>
      )}

      <ConnectDrawer
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        device={isDeviceRunning(device) ? device : null}
        status={proxy.status}
      />
      <RulesDrawer open={rulesOpen} onClose={() => setRulesOpen(false)} config={proxy.config} knownUrls={knownUrls} />
    </div>
  );
};

export default ProxyTool;
