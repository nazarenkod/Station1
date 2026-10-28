import {IconDeviceMobile, IconPlayerStop} from '@tabler/icons-react';
import {Button} from 'antd';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router';

import {answerHandsCard, stopHands, useAgent} from '../../lib/agent/agent-store.js';
import {viewScreen} from '../A11yTool/screen-history.js';

import styles from './Agent.module.css';

/**
 * What the agent does on the device in the turn: «The Operator drives the
 * device» with «Stop» while the turn runs, a line for each action (it opens
 * the screen the action led to), and the cards that wait for the person.
 */
const HandsBlock = ({busy}) => {
  const {t} = useTranslation();
  const navigate = useNavigate();
  const agent = useAgent();
  const steps = agent.handsSteps;
  if (!steps.length && !agent.handsCards.length) {
    return null;
  }
  const open = (step) => {
    if (step.screenKey) {
      viewScreen(step.screenKey, step.stateId ?? null);
      navigate('/inspector');
    }
  };
  return (
    <>
      {steps.length > 0 && (
        <div className={`${styles.card} ${styles.hands}`} aria-label={t('agentHandsTitle')}>
          <span className={styles.permissionHead}>
            <IconDeviceMobile size={15} className={styles.handsIcon} />
            <b>{busy ? t('agentHandsDriving') : t('agentHandsDone', {count: steps.length})}</b>
            {busy && (
              <Button size="small" danger icon={<IconPlayerStop size={14} />} onClick={stopHands}>
                {t('agentHandsStop')}
              </Button>
            )}
          </span>
          <ol className={styles.handsSteps}>
            {steps.map((step) => (
              <li key={`${step.at}-${step.line}`}>
                <button
                  type="button"
                  className={`${styles.handsStep} ${step.ok === false ? styles.warn : ''}`}
                  disabled={!step.screenKey}
                  title={step.screenAfter ? t('agentHandsOpenScreen', {screen: step.screenAfter}) : undefined}
                  onClick={() => open(step)}
                >
                  {step.line}
                  {step.screenAfter && <span className={styles.muted}> → {step.screenAfter}</span>}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
      {agent.handsCards.map((card) => (
        <div key={card.id} className={`${styles.card} ${styles.permission}`}>
          {card.kind === 'otp' ? (
            <>
              <b>{t('agentHandsOtp', {account: card.account ?? ''})}</b>
              <span className={styles.muted}>{t('agentHandsOtpHint')}</span>
              <div className={styles.cardActions}>
                <Button size="small" type="primary" onClick={() => answerHandsCard(card.id, true)}>
                  {t('agentHandsOtpDone')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <b>{t('agentHandsMore', {count: steps.length})}</b>
              <div className={styles.cardActions}>
                <Button size="small" type="primary" onClick={() => answerHandsCard(card.id, true)}>
                  {t('agentHandsMoreYes')}
                </Button>
                <Button size="small" type="text" onClick={() => answerHandsCard(card.id, false)}>
                  {t('agentHandsMoreNo')}
                </Button>
              </div>
            </>
          )}
        </div>
      ))}
    </>
  );
};

export default HandsBlock;
