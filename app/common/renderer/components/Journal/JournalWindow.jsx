import {IconClearAll, IconCopy, IconDeviceFloppy} from '@tabler/icons-react';
import {App, Button, Empty, Input, Segmented, Tag} from 'antd';
import {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {
  filterEntries,
  formatDuration,
  formatJournal,
  formatSummary,
  formatTime,
  runningEntries,
  SOURCES,
} from '../../../shared/journal.js';
import {backend} from '../../polyfills.js';
import {clearJournal, useJournal} from './journal-store.js';

import styles from './Journal.module.css';

// more rows than this make the window slow; the filter narrows them
const SHOWN_ROWS = 1000;

const LEVEL_DOT = {error: 'error', warn: 'warn', info: 'info', debug: 'off'};

/**
 * One record: time, level, source and text; a click opens its details.
 */
const Row = ({entry, open, onToggle, previous}) => {
  const {t} = useTranslation();
  const unfinished = entry.state === 'running';
  return (
    <li className={styles.row}>
      <button className={styles.rowHead} onClick={onToggle} aria-expanded={open}>
        <span className={styles.time}>{formatTime(entry.time)}</span>
        <span className={`${styles.dot} ${styles[`dot_${LEVEL_DOT[entry.level]}`]}`} aria-label={entry.level} />
        <span className={styles.source}>{t(`journalSource_${entry.source}`)}</span>
        <span className={styles.text}>
          {entry.text}
          {entry.outcome && <span className={styles.outcome}> → {entry.outcome}</span>}
        </span>
        <span className={styles.duration}>
          {unfinished
            ? previous
              ? t('journalUnfinished')
              : t('journalRunningShort')
            : entry.duration != null && formatDuration(entry.duration)}
        </span>
      </button>
      {open && entry.detail && <pre className={styles.detail}>{entry.detail}</pre>}
    </li>
  );
};

/**
 * What runs now, longest first: a command or call that hangs is on top.
 */
const Running = ({entries}) => {
  const {t} = useTranslation();
  const [now, setNow] = useState(Date.now());
  const running = runningEntries(entries, now);
  const any = running.length > 0;

  useEffect(() => {
    if (!any) {
      return undefined;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [any]);

  if (!any) {
    return null;
  }
  return (
    <section className={styles.running} aria-labelledby="journal-running">
      <h2 id="journal-running" className="vi-eyebrow">
        {t('journalRunning')}
      </h2>
      <ul>
        {running.map((entry) => (
          <li key={entry.id} className={`${styles.runningRow} ${entry.slow ? styles.slow : ''}`}>
            <span className={`${styles.dot} ${styles[entry.slow ? 'dot_warn' : 'dot_info']}`} aria-hidden="true" />
            <span className={styles.source}>{t(`journalSource_${entry.source}`)}</span>
            <span className={styles.text}>{entry.text}</span>
            <span className={styles.duration}>
              {entry.slow && <span className={styles.slowTag}>{t('journalSlow')}</span>}
              {formatDuration(entry.elapsed)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};

/**
 * The journal of the station: what it runs, what the interface asks of it,
 * what failed. The run before can be read too, if this one started after a hang.
 */
const JournalWindow = () => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const current = useJournal();
  const [run, setRun] = useState('current');
  const [previous, setPrevious] = useState(undefined);
  const [level, setLevel] = useState('all');
  const [sources, setSources] = useState([]);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    document.title = t('journalTitle');
  }, [t]);

  useEffect(() => {
    if (run === 'previous' && previous === undefined) {
      backend.journal.previous().then((journal) => setPrevious(journal));
    }
  }, [run, previous]);

  const shown = run === 'current' ? current : previous;
  const entries = useMemo(() => shown?.entries ?? [], [shown]);
  const matching = useMemo(() => filterEntries(entries, {level, sources, query}), [entries, level, sources, query]);
  const rows = matching.slice(-SHOWN_ROWS).reverse();

  const toggleSource = (source) =>
    setSources(sources.includes(source) ? sources.filter((s) => s !== source) : [...sources, source]);

  // the whole run goes out, not just what the filter shows
  const asText = () => formatJournal({summary: shown?.summary, entries});

  const copy = async () => {
    await navigator.clipboard.writeText(asText());
    message.success(t('journalCopied'));
  };

  const save = async () => {
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
    const path = await backend.journal.save(asText(), `station-journal-${stamp}.txt`);
    if (path) {
      message.success(t('journalSaved', {path}));
    }
  };

  const summary = formatSummary(shown?.summary ?? {});

  return (
    <div className={styles.journal}>
      <header className={styles.toolbar}>
        <h1 className={styles.title}>{t('journalTitle')}</h1>
        <Segmented
          size="small"
          value={run}
          onChange={setRun}
          options={[
            {value: 'current', label: t('journalCurrent')},
            {value: 'previous', label: t('journalPrevious')},
          ]}
        />
        <span className={styles.spacer} />
        <Button size="small" icon={<IconCopy size={14} />} onClick={copy} disabled={!shown}>
          {t('journalCopy')}
        </Button>
        <Button size="small" icon={<IconDeviceFloppy size={14} />} onClick={save} disabled={!shown}>
          {t('journalSave')}
        </Button>
        {run === 'current' && (
          <Button size="small" icon={<IconClearAll size={14} />} onClick={clearJournal}>
            {t('journalClear')}
          </Button>
        )}
      </header>

      <div className={styles.filters}>
        <Segmented
          size="small"
          value={level}
          onChange={setLevel}
          options={['error', 'warn', 'all'].map((value) => ({value, label: t(`journalLevel_${value}`)}))}
        />
        <div className={styles.sources}>
          {SOURCES.map((source) => (
            <Tag.CheckableTag key={source} checked={sources.includes(source)} onChange={() => toggleSource(source)}>
              {t(`journalSource_${source}`)}
            </Tag.CheckableTag>
          ))}
        </div>
        <Input.Search
          size="small"
          allowClear
          className={styles.search}
          placeholder={t('journalSearch')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className={styles.body}>
        {run === 'previous' && previous === null ? (
          <Empty description={t('journalNoPrevious')} />
        ) : (
          <>
            {summary.length > 0 && (
              <details className={styles.summary}>
                <summary className="vi-eyebrow">{t('journalSummary')}</summary>
                <pre>{summary.join('\n')}</pre>
              </details>
            )}
            {run === 'current' && <Running entries={entries} />}
            {rows.length ? (
              <ul className={styles.list}>
                {rows.map((entry) => (
                  <Row
                    key={entry.id}
                    entry={entry}
                    previous={run === 'previous'}
                    open={openId === entry.id}
                    onToggle={() => setOpenId(openId === entry.id ? null : entry.id)}
                  />
                ))}
              </ul>
            ) : (
              <Empty description={entries.length ? t('journalNoMatch') : t('journalEmpty')} />
            )}
            {matching.length > SHOWN_ROWS && (
              <div className={styles.more}>{t('journalShown', {shown: SHOWN_ROWS, total: matching.length})}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default JournalWindow;
