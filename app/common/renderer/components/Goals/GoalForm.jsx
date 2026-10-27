import {Input, Modal, Select} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {cleanGoal, FIELD_OPS, FIELD_PLACES, GOAL_TYPES, goalProblem} from '../../../shared/agent/goals.js';
import {closeGoalForm, useGoalForm} from '../../lib/goals/goal-form.js';
import {addGoal} from '../../lib/goals/goals-store.js';

import styles from './Goals.module.css';

const FIELDS = {
  request: ['method', 'path'],
  field: ['method', 'path', 'where', 'field', 'op', 'value'],
  status: ['method', 'path', 'status'],
  log: ['pattern', 'level', 'tag', 'mode'],
  screen: ['screen', 'state'],
  noFlags: ['method', 'path'],
  manual: [],
};

const SELECTS = {
  where: FIELD_PLACES,
  op: FIELD_OPS,
  mode: ['seen', 'notSeen'],
  level: ['', 'V', 'D', 'I', 'W', 'E', 'F'],
};

/** The goal form, one for the window; see lib/goals/goal-form.js. */
const GoalForm = () => {
  const {t} = useTranslation();
  const form = useGoalForm();
  const [goal, setGoal] = useState(() => cleanGoal({}));
  useEffect(() => {
    if (form.open) {
      setGoal(cleanGoal(form.initial ?? {}));
    }
  }, [form.open, form.initial]);

  const problem = goalProblem(goal);
  const set = (patch) => setGoal(cleanGoal({...goal, ...patch}));
  const setParam = (name, value) => setGoal(cleanGoal({...goal, params: {...goal.params, [name]: value}}));

  return (
    <Modal
      open={form.open}
      title={form.initial?.id ? t('goalEdit') : t('goalNew')}
      okText={t('goalSave')}
      cancelText={t('Cancel')}
      okButtonProps={{disabled: !!problem}}
      onCancel={closeGoalForm}
      onOk={async () => {
        await (form.onSave ? form.onSave(goal) : addGoal(goal));
        closeGoalForm();
      }}
      destroyOnHidden
    >
      <div className={styles.form}>
        <label>
          <span>{t('goalTitle')}</span>
          <Input value={goal.title} onChange={(e) => set({title: e.target.value})} placeholder={t('goalTitleHint')} />
        </label>
        <label>
          <span>{t('goalType')}</span>
          <Select
            value={goal.type}
            onChange={(type) => set({type})}
            options={GOAL_TYPES.map((type) => ({value: type, label: t(`goalType_${type}`)}))}
          />
        </label>
        {FIELDS[goal.type].map((name) => (
          <label key={name}>
            <span>{t(`goalParam_${name}`)}</span>
            {SELECTS[name] ? (
              <Select
                value={goal.params[name]}
                onChange={(value) => setParam(name, value)}
                options={SELECTS[name].map((value) => ({
                  value,
                  label: value ? t(`goalValue_${value.replace('.', '_')}`, {defaultValue: value}) : t('goalAnyLevel'),
                }))}
              />
            ) : (
              <Input
                value={goal.params[name]}
                onChange={(e) => setParam(name, e.target.value)}
                placeholder={t(`goalHint_${name}`, {defaultValue: ''})}
                className={['path', 'field', 'pattern', 'value'].includes(name) ? styles.mono : ''}
              />
            )}
          </label>
        ))}
        <label>
          <span>{t('goalExpectOn')}</span>
          <Input
            value={goal.expectOn}
            onChange={(e) => set({expectOn: e.target.value})}
            placeholder={t('goalExpectOnHint')}
          />
        </label>
        {problem && <span className={styles.warn}>{t(`goalProblem_${problem}`)}</span>}
      </div>
    </Modal>
  );
};

export default GoalForm;
