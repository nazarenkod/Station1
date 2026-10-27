import {IconBrain, IconCopy, IconPencil, IconPlus, IconSend, IconTrash} from '@tabler/icons-react';
import {App, Button, Checkbox, Dropdown, Input, Modal, Tooltip} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router';

import {askOnTask} from '../../lib/agent/agent-store.js';
import {focusOn} from '../../lib/agent/selection.js';
import {openGoalForm} from '../../lib/goals/goal-form.js';
import {counts, pastRuns, removeGoal, reportOf, setManual, updateGoal, useGoals} from '../../lib/goals/goals-store.js';
import {useTask} from '../../lib/task/task-store.js';
import {backend} from '../../polyfills.js';
import {goalSummary} from './goal-text.js';

import styles from './Goals.module.css';

const MARK = {passed: '✅', failed: '❌', pending: '⏳', holding: '🟢', manual: '☐'};
const TOOL_OF = {request: '/proxy', log: '/logs', screen: '/session'};

const useReportLabels = () => {
  const {t} = useTranslation();
  return {
    title: t('goalReportTitle'),
    when: t('goalReportWhen'),
    app: t('goalReportApp'),
    device: t('goalReportDevice'),
    result: t('goalReportResult'),
    passed: t('goalState_passed'),
    failed: t('goalState_failed'),
    states: Object.fromEntries(
      ['passed', 'failed', 'pending', 'holding', 'manual'].map((one) => [one, t(`goalState_${one}`)]),
    ),
  };
};

const ReportModal = ({open, onClose, run}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const task = useTask();
  const labels = useReportLabels();
  const [sending, setSending] = useState(false);
  const report =
    open && run ? reportOf({key: task.current, summary: task.data?.context?.task.summary}, run, labels) : '';
  return (
    <Modal open={open} onCancel={onClose} title={t('goalReport')} footer={null} width={640} destroyOnHidden>
      <Input.TextArea value={report} readOnly className={styles.report} autoSize={{minRows: 10, maxRows: 24}} />
      <div className={`${styles.head} ${styles.reportActions}`}>
        <Button
          icon={<IconCopy size={14} />}
          onClick={() => navigator.clipboard.writeText(report).then(() => message.success(t('goalReportCopied')))}
        >
          {t('goalReportCopy')}
        </Button>
        <Button
          type="primary"
          icon={<IconSend size={14} />}
          loading={sending}
          onClick={async () => {
            setSending(true);
            const result = await backend.task.comment(task.current, report);
            setSending(false);
            if (result.ok) {
              message.success(t('goalReportSent', {key: task.current}));
              onClose();
            } else {
              message.error(t(`taskError_${result.error}`, {defaultValue: t('goalReportFailed')}));
            }
          }}
        >
          {t('goalReportSend', {key: task.current})}
        </Button>
      </div>
    </Modal>
  );
};

/**
 * The goals of the task's session: what the station counts by itself, how
 * each stands with its evidence, the report, earlier runs.
 */
const GoalsPanel = () => {
  const {t} = useTranslation();
  const navigate = useNavigate();
  const task = useTask();
  const goals = useGoals();
  const [report, setReport] = useState(null);

  if (!task.current || !task.data?.context) {
    return null;
  }
  const states = goals.run?.states ?? {};
  const sum = counts();
  const past = pastRuns(task.data);

  const open = (evidence) => {
    if (evidence?.kind && TOOL_OF[evidence.kind]) {
      focusOn(evidence.kind, evidence.id);
      navigate(TOOL_OF[evidence.kind]);
    }
  };

  return (
    <section className={`vi-panel ${styles.panel}`} aria-label={t('goalsTitle')}>
      <div className={styles.head}>
        <span className={styles.title}>{t('goalsTitle')}</span>
        {goals.goals.length > 0 && (
          <span className={styles.counts}>
            {t('goalsCounts', {passed: sum.passed, total: sum.total, failed: sum.failed})}
          </span>
        )}
        <span className={styles.spacer} />
        <Button size="small" onClick={() => askOnTask(t('goalsProposePrompt', {key: task.current}), {deep: true})}>
          {t('goalsPropose')}
        </Button>
        <Button size="small" icon={<IconPlus size={14} />} onClick={() => openGoalForm({source: 'manual'})}>
          {t('goalsAdd')}
        </Button>
        {goals.run && goals.goals.length > 0 && (
          <Button size="small" onClick={() => setReport(goals.run)}>
            {t('goalReport')}
          </Button>
        )}
        {past.length > 0 && (
          <Dropdown
            menu={{
              items: past.map((run) => ({
                key: run.id,
                label: `${new Date(run.startedAt).toLocaleString()} · ${run.device ?? ''} ${run.app ?? ''}`,
              })),
              onClick: ({key}) => setReport(past.find((run) => run.id === key)),
            }}
          >
            <Button size="small">{t('goalsPast', {count: past.length})}</Button>
          </Dropdown>
        )}
      </div>
      {!goals.goals.length && <span className={styles.dim}>{t('goalsEmpty')}</span>}
      {goals.goals.map((goal) => {
        const state = states[goal.id] ?? {state: 'pending'};
        return (
          <div key={goal.id} className={styles.row}>
            <span className={styles.mark} title={t(`goalState_${state.state}`)}>
              {goal.type === 'manual' ? (
                <Checkbox checked={state.state === 'passed'} onChange={(e) => setManual(goal.id, e.target.checked)} />
              ) : (
                MARK[state.state]
              )}
            </span>
            <div className={styles.body}>
              <span className={state.state === 'failed' ? styles.failed : ''}>{goal.title}</span>
              <span className={styles.summary}>
                {goalSummary(goal, t)}
                {goal.expectOn ? ` · ${t('goalOn', {screen: goal.expectOn})}` : ''}
              </span>
              {state.evidence?.label && (
                <button type="button" className={styles.evidence} onClick={() => open(state.evidence)}>
                  {t(`goalState_${state.state}`)}: {state.evidence.label}
                  {state.note ? ` (${state.note})` : ''} · {new Date(state.at).toLocaleTimeString()}
                </button>
              )}
            </div>
            <div className={styles.actions}>
              {state.state === 'failed' && (
                <Tooltip title={t('goalAsk')}>
                  <Button
                    size="small"
                    type="text"
                    icon={<IconBrain size={14} />}
                    aria-label={t('goalAsk')}
                    onClick={() =>
                      askOnTask(
                        t('goalAskPrompt', {
                          title: goal.title,
                          evidence: state.evidence?.label ?? '',
                          note: state.note ?? '',
                        }),
                        {
                          chips:
                            state.evidence?.kind === 'request'
                              ? [{kind: 'request', id: state.evidence.id, label: state.evidence.label}]
                              : [],
                        },
                      )
                    }
                  />
                </Tooltip>
              )}
              <Button
                size="small"
                type="text"
                icon={<IconPencil size={14} />}
                aria-label={t('goalEdit')}
                onClick={() => openGoalForm(goal, (next) => updateGoal(goal.id, next))}
              />
              <Button
                size="small"
                type="text"
                danger
                icon={<IconTrash size={14} />}
                aria-label={t('goalRemove')}
                onClick={() => removeGoal(goal.id)}
              />
            </div>
          </div>
        );
      })}
      <ReportModal open={!!report} run={report} onClose={() => setReport(null)} />
    </section>
  );
};

export default GoalsPanel;
