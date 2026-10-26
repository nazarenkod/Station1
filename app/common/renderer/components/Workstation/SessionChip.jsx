import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import styles from './Workstation.module.css';

const pad = (n) => String(n).padStart(2, '0');

export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/**
 * The running Appium session and how long it lasts; without one, whether our
 * Appium server is up.
 */
const SessionChip = () => {
  const {t} = useTranslation();
  const navigate = useNavigate();
  const hasSession = useSelector((state) => !!state.inspector.driver);
  const startedAt = useSelector((state) => state.inspector.sessionStartTime);
  const appium = useSelector((state) => state.workstation.appium);
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

  const running = appium?.status === 'running';
  return (
    <button
      className={styles.chip}
      title={running ? t('wsAppiumRunning', {port: appium.port}) : undefined}
      onClick={() => navigate('/session')}
    >
      <span className={`${styles.dot} ${running ? styles.dotOn : styles.dotOff}`} />
      <span className={running ? styles.chipText : undefined}>
        {running ? t('wsAppiumRunning', {port: appium.port}) : t('wsNoSession')}
      </span>
    </button>
  );
};

export default SessionChip;
