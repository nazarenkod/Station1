import {Tooltip} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {backend} from '../../polyfills.js';

import styles from './Workstation.module.css';

const pad = (n) => String(n).padStart(2, '0');

export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

const DOT_CLASS = {ok: 'dotOn', warn: 'dotWarn', error: 'dotError'};

/**
 * The station's journal as a dot: green when nothing went wrong since the
 * journal was last looked at, amber for warnings, red for errors.
 */
const JournalDot = () => {
  const {t} = useTranslation();
  const [health, setHealth] = useState({status: 'ok', errors: 0, warnings: 0});
  useEffect(() => {
    backend.journal.health?.().then((now) => now && setHealth(now));
    return backend.journal.onHealth?.(setHealth);
  }, []);
  const title =
    health.status === 'ok'
      ? t('wsJournalOk')
      : t('wsJournalIssues', {errors: health.errors, warnings: health.warnings});
  return (
    <Tooltip title={`${t('journalTitle')} · ${title} · ⌥⌘L`}>
      <button className={styles.journalDot} aria-label={t('journalTitle')} onClick={() => backend.journal.open()}>
        <span className={`${styles.dot} ${styles[DOT_CLASS[health.status]]}`} />
      </button>
    </Tooltip>
  );
};

/**
 * The running Appium session and how long it lasts; without one, the dot of
 * the station's journal.
 */
const SessionChip = () => {
  const {t} = useTranslation();
  const navigate = useNavigate();
  const hasSession = useSelector((state) => !!state.inspector.driver);
  const startedAt = useSelector((state) => state.inspector.sessionStartTime);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!hasSession) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasSession]);

  if (hasSession) {
    return (
      <button
        className={`${styles.chip} ${styles.chipLive}`}
        aria-label={t('wsSession')}
        title={t('wsSession')}
        onClick={() => navigate('/inspector')}
      >
        <span className={`${styles.dot} ${styles.dotRec}`} />
        <span className={styles.chipText}>{t('wsSession')}</span>
        <span className={styles.mono}>{formatElapsed(startedAt ? now - startedAt : 0)}</span>
      </button>
    );
  }

  // no session: the station's journal as a dot, green while nothing went wrong since it was last opened
  if (!backend.journal) {
    return null;
  }
  return <JournalDot />;
};

export default SessionChip;
