import {
  IconDatabase,
  IconDeviceMobile,
  IconDots,
  IconEye,
  IconFolders,
  IconRefresh,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react';
import {Alert, App, Button, Dropdown, Input, Switch, Tag, Tooltip} from 'antd';
import {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {activeDevice, isDeviceRunning} from '../../actions/Workstation.js';
import {adviceText, useProjectAdvice} from '../../lib/settings/project-advice.js';
import {appDataPins} from '../../lib/settings/views.js';
import {backend} from '../../polyfills.js';
import EmptyState from '../Workstation/EmptyState.jsx';
import {AdviceActions} from '../Workstation/ProjectAdvice.jsx';
import {
  attachAppData,
  clearBackups,
  clearData,
  refresh,
  search,
  selectTarget,
  setWatching,
  useAppData,
} from './app-data-store.js';
import ChangesPanel from './ChangesPanel.jsx';
import DbView from './DbView.jsx';
import FilesView from './FilesView.jsx';
import {formatSize} from './format.js';
import PinsBar from './PinsBar.jsx';
import PrefsView from './PrefsView.jsx';
import SearchResults from './SearchResults.jsx';

import styles from './AppData.module.css';

const SEARCH_DELAY_MS = 300;

const baseName = (file) => file.split('/').at(-1);
const groupOf = (file) => (file.startsWith('@') ? file.slice(1, file.indexOf('/')) : null);

// the place to show first: the first preferences file, else the first database, else the files
const firstPlace = (snapshot) =>
  snapshot?.prefs[0]
    ? {section: 'prefs', file: snapshot.prefs[0].file}
    : snapshot?.dbs[0]
      ? {section: 'dbs', file: snapshot.dbs[0].file}
      : {section: 'files', file: null};

/**
 * The data of the app chosen in the title bar: preferences, databases and
 * files of its sandbox, what changes in them, and the person's own edits.
 */
const AppDataTool = () => {
  const {t} = useTranslation();
  const {message, modal} = App.useApp();
  const navigate = useNavigate();
  const workstation = useSelector((state) => state.workstation);
  const device = activeDevice(workstation);
  const appId = workstation.app?.id ?? null;
  const data = useAppData();
  const advice = useProjectAdvice();
  const pinsByApp = appDataPins.use();
  const [query, setQuery] = useState('');
  const [place, setPlace] = useState(null);
  const snapshot = data.snapshot;
  const running = isDeviceRunning(device);

  useEffect(() => {
    attachAppData();
  }, []);

  // the tab reads when it opens and when the device or app changes; it stops watching when it closes
  useEffect(() => {
    if (backend.appData && running && appId) {
      setPlace(null);
      setQuery('');
      // chosen here too: the follower in the shell may not have told the main process yet
      selectTarget(device, appId).then(() => refresh());
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.id, appId, running]);
  useEffect(() => () => void setWatching(false), []);

  useEffect(() => {
    const timer = setTimeout(() => search(query), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const pins = useMemo(() => pinsByApp?.[appId] ?? [], [pinsByApp, appId]);
  // from the saved list itself, so two quick clicks do not undo each other
  const togglePin = (file, key) =>
    appDataPins.update((view) => {
      const list = view[appId] ?? [];
      const same = (pin) => pin.file === file && pin.key === key;
      return {
        [appId]: list.some(same)
          ? list.filter((pin) => !same(pin))
          : [...list, key === undefined ? {file} : {file, key}],
      };
    });

  const current = place ?? firstPlace(snapshot);
  const pinnedKeys = useMemo(
    () => new Set(pins.filter((pin) => pin.file === current.file && pin.key !== undefined).map((pin) => pin.key)),
    [pins, current.file],
  );
  const open = (target) => {
    setQuery('');
    if (target.section === 'files' || target.section === 'prefs' || target.section === 'dbs') {
      setPlace(target);
    } else if (target.section === 'db') {
      setPlace({section: 'dbs', file: target.file, table: target.table});
    }
  };
  const openChange = (change) =>
    open(
      change.section === 'prefs'
        ? {section: 'prefs', file: change.file, key: change.key}
        : change.section === 'db'
          ? {section: 'dbs', file: change.file, table: change.table}
          : {section: 'files', file: change.file},
    );

  const confirmClear = () =>
    modal.confirm({
      title: t('dataClearTitle', {app: appId}),
      content: snapshot?.target?.access === 'devicectl' ? t('dataNotSupported_clear') : t('dataClearText'),
      okText: t('dataClear'),
      okButtonProps: {danger: true, disabled: snapshot?.target?.access === 'devicectl'},
      cancelText: t('dataCancel'),
      onOk: async () => {
        const result = await clearData();
        if (result?.ok) {
          message.success(t('dataCleared'));
        } else {
          message.error(
            result?.code === 'notSupported' ? t('dataNotSupported_clear') : (result?.error ?? t('dataFailed')),
          );
        }
      },
    });

  if (!backend.appData) {
    return <EmptyState tool="data" icon={IconDatabase} title={t('dataDesktopOnly')} />;
  }
  if (!running) {
    return (
      <EmptyState
        tool="data"
        icon={IconDatabase}
        title={t('dataNoDeviceTitle')}
        text={t('dataNoDevice')}
        steps={[t('dataStepConnect'), t('dataStepApp'), t('dataStepOpen')]}
        actions={
          <Button type="primary" icon={<IconDeviceMobile size={16} />} onClick={() => navigate('/station')}>
            {t('dataToDevices')}
          </Button>
        }
      />
    );
  }
  if (!appId) {
    return (
      <EmptyState
        tool="data"
        icon={IconDatabase}
        title={t('dataNoAppTitle')}
        text={advice ? adviceText(t, advice) : t('dataNoApp')}
        actions={<AdviceActions advice={advice} />}
      />
    );
  }

  const error = snapshot?.error;
  const prefsNow = current.section === 'prefs' ? snapshot?.prefs.find((one) => one.file === current.file) : null;
  const dbNow = current.section === 'dbs' ? snapshot?.dbs.find((one) => one.file === current.file) : null;
  const totals = snapshot?.totals;

  return (
    <div className={styles.tool}>
      <div className={styles.toolbar}>
        <span className={styles.appName}>
          <IconDatabase size={16} />
          <span className={styles.mono}>{appId}</span>
        </span>
        {snapshot?.target?.access && (
          <Tooltip title={t(`dataAccessHint_${snapshot.target.access}`)}>
            <Tag className={styles.accessTag}>{t(`dataAccess_${snapshot.target.access}`)}</Tag>
          </Tooltip>
        )}
        <Input.Search
          className={styles.searchBox}
          placeholder={t('dataSearchPlaceholder')}
          allowClear
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          loading={data.search.busy}
        />
        <Button
          icon={<IconRefresh size={16} className={data.busy ? styles.spin : ''} />}
          onClick={() => refresh()}
          disabled={data.busy}
        >
          {t('dataRefresh')}
        </Button>
        <Tooltip title={t('dataWatchHint')}>
          <span className={`${styles.watch} ${data.watching ? styles.watchOn : ''}`}>
            <IconEye size={15} />
            {t('dataWatch')}
            <Switch size="small" checked={data.watching} onChange={(on) => setWatching(on)} />
          </span>
        </Tooltip>
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              {key: 'clear', danger: true, icon: <IconTrash size={14} />, label: t('dataClear'), onClick: confirmClear},
              {
                key: 'backups',
                icon: <IconFolders size={14} />,
                label: t('dataClearBackups'),
                onClick: async () => {
                  await clearBackups();
                  message.success(t('dataBackupsCleared'));
                },
              },
            ],
          }}
        >
          <Button icon={<IconDots size={16} />} aria-label={t('dataMore')} />
        </Dropdown>
      </div>

      {error && (
        <Alert
          className={styles.banner}
          type={error.reason === 'failed' ? 'error' : 'warning'}
          showIcon
          title={t(`dataNoAccess_${error.reason}`, {defaultValue: t('dataNoAccess_failed')})}
          description={
            <>
              <div>{t(`dataNoAccessHint_${error.reason}`, {defaultValue: ''})}</div>
              {error.detail && <pre className={styles.toolText}>{error.detail}</pre>}
            </>
          }
        />
      )}

      <PinsBar
        pins={pins}
        snapshot={snapshot}
        marks={data.marks}
        onOpen={open}
        onUnpin={(pin) => togglePin(pin.file, pin.key)}
      />

      <div className={styles.body}>
        <nav className={styles.nav}>
          <div className={styles.navHead}>
            <IconSettings size={14} /> {t('dataSection_prefs')}
            <span className={styles.count}>{totals?.prefs ?? 0}</span>
          </div>
          {snapshot?.prefs.map((prefs) => (
            <button
              key={prefs.file}
              type="button"
              className={`${styles.navItem} ${current.section === 'prefs' && current.file === prefs.file ? styles.navOn : ''}`}
              onClick={() => open({section: 'prefs', file: prefs.file})}
              title={prefs.file}
            >
              <span className={styles.navName}>{baseName(prefs.file)}</span>
              {groupOf(prefs.file) && <span className={styles.navTag}>{t('dataGroup')}</span>}
              <span className={styles.navCount}>{prefs.entries.length}</span>
            </button>
          ))}
          <div className={styles.navHead}>
            <IconDatabase size={14} /> {t('dataSection_dbs')}
            <span className={styles.count}>{totals?.dbs ?? 0}</span>
          </div>
          {snapshot?.dbs.map((db) => (
            <button
              key={db.file}
              type="button"
              className={`${styles.navItem} ${current.section === 'dbs' && current.file === db.file ? styles.navOn : ''}`}
              onClick={() => open({section: 'dbs', file: db.file})}
              title={db.file}
            >
              <span className={styles.navName}>{baseName(db.file)}</span>
              <span className={styles.navCount}>{db.tables.length}</span>
            </button>
          ))}
          <div className={styles.navHead}>
            <IconFolders size={14} /> {t('dataSection_files')}
            <span className={styles.count}>{totals?.files ?? 0}</span>
          </div>
          <button
            type="button"
            className={`${styles.navItem} ${current.section === 'files' ? styles.navOn : ''}`}
            onClick={() => open({section: 'files', file: current.section === 'files' ? current.file : null})}
          >
            <span className={styles.navName}>{t('dataSandbox')}</span>
            <span className={styles.navCount}>{formatSize(totals?.bytes ?? 0)}</span>
          </button>
          {snapshot?.readAt && (
            <p className={styles.readAt}>{t('dataReadAt', {time: new Date(snapshot.readAt).toLocaleTimeString()})}</p>
          )}
        </nav>

        <main className={styles.content}>
          {query.trim() ? (
            <SearchResults search={data.search} onOpen={open} />
          ) : !snapshot ? (
            <p className={styles.hint}>{t('dataReading')}</p>
          ) : prefsNow ? (
            <PrefsView
              prefs={prefsNow}
              marks={data.marks}
              changes={data.changes}
              pinned={pinnedKeys}
              onTogglePin={togglePin}
              platform={snapshot.target.platform}
            />
          ) : dbNow ? (
            <DbView db={dbNow} table={current.table} marks={data.marks} version={snapshot.readAt} />
          ) : current.section === 'files' ? (
            <FilesView
              files={snapshot.files}
              marks={data.marks}
              selected={current.file}
              onSelect={(file) => setPlace({section: 'files', file})}
              version={snapshot.readAt}
              canDelete={snapshot.target.access !== 'devicectl'}
              pinned={new Set(pins.filter((pin) => pin.key === undefined).map((pin) => pin.file))}
              onTogglePin={(file) => togglePin(file, undefined)}
            />
          ) : (
            <p className={styles.hint}>{t('dataNothingHere')}</p>
          )}
        </main>
      </div>

      <ChangesPanel changes={data.changes} edits={data.edits} onOpen={openChange} />
    </div>
  );
};

export default AppDataTool;
