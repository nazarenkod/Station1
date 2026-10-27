import {Button} from 'antd';
import {useTranslation} from 'react-i18next';

import {dismissGoalProposal} from '../../lib/agent/agent-store.js';
import {openGoalForm} from '../../lib/goals/goal-form.js';
import {addGoal} from '../../lib/goals/goals-store.js';
import {goalSummary} from './goal-text.js';

import styles from '../Agent/Agent.module.css';

/** A goal the agent proposed: it counts only if the person adds it. */
const GoalCard = ({proposal}) => {
  const {t} = useTranslation();
  const {goal} = proposal;
  const accept = async (next) => {
    await addGoal(next);
    dismissGoalProposal(proposal.id);
  };
  return (
    <div className={styles.card}>
      <b>{t('goalProposalTitle')}</b>
      <span>{goal.title}</span>
      <span className={styles.muted}>{goalSummary(goal, t)}</span>
      {goal.why && <span className={styles.muted}>{goal.why}</span>}
      <div className={styles.cardActions}>
        <Button size="small" type="primary" onClick={() => accept(goal)}>
          {t('goalAccept')}
        </Button>
        <Button size="small" onClick={() => openGoalForm(goal, accept)}>
          {t('goalChange')}
        </Button>
        <Button size="small" onClick={() => dismissGoalProposal(proposal.id)}>
          {t('goalReject')}
        </Button>
      </div>
    </div>
  );
};

export default GoalCard;
