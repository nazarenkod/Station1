import {IconEye, IconHistory} from '@tabler/icons-react';
import {Alert, Button, Switch, Tooltip} from 'antd';
import {useTranslation} from 'react-i18next';
import {useDispatch} from 'react-redux';

import {refreshA11yScreen, showStoredA11yScreen} from '../../actions/A11y.js';
import {stopViewing, useScreenHistory, viewScreen} from './screen-history.js';

import styles from './A11yTool.module.css';

const time = (at) => new Date(at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});

const scoreTone = (score) => (score >= 90 ? 'ok' : score >= 70 ? 'warn' : 'danger');

/**
 * Above the audit: whether the tool follows the device, and the screens the
 * session went through, each one a click away from being shown again.
 */
const ScreenStrip = ({follow, onFollowChange, follower}) => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const {screens, currentKey, viewingKey} = useScreenHistory();
  const viewing = screens.find((screen) => screen.key === viewingKey);

  const open = (screen) => {
    if (screen.key === viewingKey) {
      return;
    }
    if (screen.key === currentKey && !viewingKey) {
      dispatch(refreshA11yScreen());
      return;
    }
    viewScreen(screen.key);
    dispatch(showStoredA11yScreen(screen));
  };

  const backToLive = () => {
    stopViewing();
    dispatch(refreshA11yScreen());
  };

  const followText = viewingKey
    ? t('a11yFollowPaused')
    : follower.status === 'reading'
      ? t('a11yFollowReading')
      : t('a11yFollowWatching');

  return (
    <div className={styles.strip}>
      <div className={styles.stripHead}>
        <Tooltip title={t('a11yFollowHint')}>
          <label className={styles.follow}>
            <Switch size="small" checked={follow} onChange={onFollowChange} />
            <span>{t('a11yFollow')}</span>
          </label>
        </Tooltip>
        {follow && (
          <span className={styles.followState}>
            <span
              className={`vi-dot ${viewingKey ? 'vi-tone-off' : follower.status === 'reading' ? 'vi-tone-warn' : 'vi-tone-ok'} ${follower.status === 'reading' ? styles.pulse : ''}`}
            />
            {followText}
          </span>
        )}
        <span className={styles.stripTitle}>
          <IconHistory size={14} stroke={1.8} aria-hidden="true" />
          {t('a11ySessionScreens')}
          <span className={styles.stripCount}>{screens.length}</span>
        </span>
      </div>

      {screens.length === 0 ? (
        <div className={styles.stripEmpty}>{t('a11ySessionScreensEmpty')}</div>
      ) : (
        <ul className={styles.screens}>
          {screens.map((screen) => {
            const active = viewingKey ? screen.key === viewingKey : screen.key === currentKey;
            return (
              <li key={screen.key}>
                <button
                  type="button"
                  className={`${styles.screenCard} ${active ? styles.screenActive : ''}`}
                  title={`${screen.title ?? t('a11yScreenUnknown')} · ${t('a11yScreenVisits', {count: screen.visits})} · ${time(screen.lastAt)}`}
                  onClick={() => open(screen)}
                >
                  {screen.thumb ? (
                    <img className={styles.screenThumb} src={screen.thumb} alt="" />
                  ) : (
                    <span className={styles.screenThumb} />
                  )}
                  <span className={styles.screenText}>
                    <span className={styles.screenName}>{screen.title ?? t('a11yScreenUnknown')}</span>
                    <span className={styles.screenMeta}>
                      <span className={`vi-pill vi-tone-${scoreTone(screen.score)}`}>{screen.score}</span>
                      {screen.counts.error > 0 && <span className={styles.countError}>{screen.counts.error}</span>}
                      {screen.counts.warning > 0 && (
                        <span className={styles.countWarning}>{screen.counts.warning}</span>
                      )}
                      {screen.visits > 1 && <span className={styles.visits}>×{screen.visits}</span>}
                    </span>
                    <span className={styles.screenTime}>
                      {screen.key === currentKey ? (
                        <>
                          <IconEye size={11} aria-hidden="true" /> {t('a11yScreenCurrent')}
                        </>
                      ) : (
                        time(screen.lastAt)
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {viewing && (
        <Alert
          type="info"
          showIcon
          className={styles.viewing}
          title={t('a11yViewingStored', {title: viewing.title ?? t('a11yScreenUnknown'), time: time(viewing.lastAt)})}
          action={
            <Button size="small" type="primary" onClick={backToLive}>
              {t('a11yBackToLive')}
            </Button>
          }
        />
      )}
    </div>
  );
};

export default ScreenStrip;
