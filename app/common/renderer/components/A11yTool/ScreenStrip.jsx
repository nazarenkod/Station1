import {IconArrowNarrowRight, IconEye, IconFileCode, IconHistory, IconStack2} from '@tabler/icons-react';
import {Alert, Button, Switch, Tooltip} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useStore} from 'react-redux';

import {refreshA11yScreen, showStoredA11yScreen} from '../../actions/A11y.js';
import {openSummary, summaryContext} from '../../lib/autotests/summary-store.js';
import {stopViewing, useScreenHistory, viewScreen} from './screen-history.js';

import styles from './ScreenStrip.module.css';

const time = (at) => new Date(at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});

const scoreTone = (score) => (score >= 90 ? 'ok' : score >= 70 ? 'warn' : 'danger');

// the state a screen was in when it was seen last
const lastState = (screen) =>
  screen?.states.find((state) => state.id === screen.currentStateId) ?? screen?.states.at(-1) ?? null;

/**
 * Above the audit: whether the tool follows the device, the screens the
 * session went through with the states of each, and the path between them,
 * each one a click away from being shown again.
 */
const ScreenStrip = ({follow, onFollowChange, follower}) => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const store = useStore();
  const {screens, path, pathDropped, currentKey, currentStateId, viewingKey, viewingStateId} = useScreenHistory();
  const [expandedKey, setExpandedKey] = useState(null);
  const byKey = new Map(screens.map((screen) => [screen.key, screen]));
  const viewing = byKey.get(viewingKey);
  const viewingState = viewing?.states.find((state) => state.id === viewingStateId) ?? lastState(viewing);
  const expanded = byKey.get(expandedKey);

  const screenName = (screen) => screen?.title ?? t('a11yScreenUnknown');
  const stateName = (state) =>
    state.title ?? (state.number > 1 ? t('a11yStateNumber', {number: state.number}) : t('a11yStateFirst'));

  const open = (screen, state = lastState(screen)) => {
    if (!screen || !state) {
      return;
    }
    if (screen.key === viewingKey && state.id === viewingStateId) {
      return;
    }
    if (screen.key === currentKey && state.id === currentStateId && !viewingKey) {
      dispatch(refreshA11yScreen());
      return;
    }
    viewScreen(screen.key, state.id);
    dispatch(showStoredA11yScreen(state));
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
        <Tooltip title={t('autotestsOpenHint')}>
          <Button
            size="small"
            type="text"
            icon={<IconFileCode size={14} />}
            disabled={!screens.some((screen) => screen.named)}
            onClick={() => openSummary(summaryContext(store.getState()))}
          >
            {t('autotestsOpen')}
          </Button>
        </Tooltip>
      </div>

      {screens.length === 0 ? (
        <div className={styles.stripEmpty}>{t('a11ySessionScreensEmpty')}</div>
      ) : (
        <ul className={styles.screens}>
          {screens.map((screen) => {
            const active = viewingKey ? screen.key === viewingKey : screen.key === currentKey;
            const state = lastState(screen);
            const many = screen.states.length > 1;
            return (
              <li key={screen.key}>
                <button
                  type="button"
                  className={`${styles.screenCard} ${active ? styles.screenActive : ''}`}
                  title={`${screenName(screen)} · ${t('a11yScreenVisits', {count: screen.visits})} · ${time(screen.lastAt)}`}
                  aria-expanded={many ? expandedKey === screen.key : undefined}
                  onClick={() => {
                    setExpandedKey(many && expandedKey !== screen.key ? screen.key : null);
                    open(screen);
                  }}
                >
                  {state?.thumb ? (
                    <img className={styles.screenThumb} src={state.thumb} alt="" />
                  ) : (
                    <span className={styles.screenThumb} />
                  )}
                  <span className={styles.screenText}>
                    <span className={styles.screenName}>{screenName(screen)}</span>
                    <span className={styles.screenMeta}>
                      <span className={`vi-pill vi-tone-${scoreTone(state.score)}`}>{state.score}</span>
                      {state.counts.error > 0 && <span className={styles.countError}>{state.counts.error}</span>}
                      {state.counts.warning > 0 && <span className={styles.countWarning}>{state.counts.warning}</span>}
                      {screen.visits > 1 && <span className={styles.visits}>×{screen.visits}</span>}
                      {many && (
                        <span
                          className={styles.statesCount}
                          title={t('a11yStatesCount', {count: screen.states.length})}
                        >
                          <IconStack2 size={11} aria-hidden="true" />
                          {screen.states.length}
                        </span>
                      )}
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

      {expanded && expanded.states.length > 1 && (
        <ul className={styles.states} aria-label={t('a11yStatesOf', {title: screenName(expanded)})}>
          {expanded.states.map((state) => {
            const active = viewingKey
              ? expanded.key === viewingKey && state.id === viewingStateId
              : expanded.key === currentKey && state.id === currentStateId;
            return (
              <li key={state.id}>
                <button
                  type="button"
                  className={`${styles.stateCard} ${active ? styles.screenActive : ''}`}
                  title={`${stateName(state)} · ${t('a11yScreenVisits', {count: state.visits})} · ${time(state.lastAt)}`}
                  onClick={() => open(expanded, state)}
                >
                  {state.thumb ? (
                    <img className={styles.screenThumb} src={state.thumb} alt="" />
                  ) : (
                    <span className={styles.screenThumb} />
                  )}
                  <span className={styles.screenName}>{stateName(state)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {path.length > 1 && (
        <ol className={styles.path} aria-label={t('a11ySessionPath')}>
          {pathDropped > 0 && <li className={styles.pathMore}>{t('a11yPathMore', {count: pathDropped})}</li>}
          {path.map((step, index) => {
            const screen = byKey.get(step.key);
            const state = screen?.states.find((entry) => entry.id === step.stateId);
            const here = index === path.length - 1;
            return (
              <li key={`${step.at}-${step.key}-${step.stateId}`} className={styles.pathStep}>
                {(index > 0 || pathDropped > 0) && (
                  <span
                    className={styles.pathArrow}
                    title={step.action ? t(`a11yAction_${step.action}`) : t('a11yActionNone')}
                  >
                    <IconArrowNarrowRight size={14} aria-hidden="true" />
                    {step.action && <span className={styles.pathAction}>{t(`a11yAction_${step.action}`)}</span>}
                  </span>
                )}
                <button
                  type="button"
                  className={`${styles.pathSpot} ${here ? styles.pathHere : ''}`}
                  disabled={!state}
                  title={`${screenName(screen)} · ${time(step.at)}`}
                  onClick={() => open(screen, state)}
                >
                  {screenName(screen)}
                  {state && screen.states.length > 1 && <span className={styles.pathState}> · {stateName(state)}</span>}
                  {step.repeat > 1 && (
                    <span className={styles.visits} title={t('a11yPathRepeat', {count: step.repeat})}>
                      {' '}
                      ×{step.repeat}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {viewing && viewingState && (
        <Alert
          type="info"
          showIcon
          className={styles.viewing}
          title={t('a11yViewingStored', {
            title:
              viewing.states.length > 1 ? `${screenName(viewing)} · ${stateName(viewingState)}` : screenName(viewing),
            time: time(viewingState.lastAt),
          })}
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
