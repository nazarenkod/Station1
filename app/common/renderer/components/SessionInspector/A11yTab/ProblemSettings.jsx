import {IconPlus, IconTrash} from '@tabler/icons-react';
import {Button, Card, Form, Input, Select, Space, Table, Tooltip} from 'antd';
import {useTranslation} from 'react-i18next';

import {compilePattern, DEFAULT_DUPLICATE_MODES} from '../../../lib/a11y/problems';
import {A11Y_RULES} from '../../../lib/a11y/types';

import styles from './A11yTab.module.css';

const MODES = ['component-value', 'component', 'screen'];
const GROUPINGS = [...MODES, 'class'];
const CONDITION_FIELDS = ['element', 'screen', 'className', 'label'];
const CONDITION_EXAMPLES = {
  element: '*#PbButton  /^.*:id\\/(tab)_\\d+$/',
  screen: 'Онбординг*',
  className: '*ImageButton',
  label: '/^Закрити$/',
};

const newId = () => Math.random().toString(36).slice(2, 10);

const invalidPatterns = (patterns = []) => patterns.filter((pattern) => !compilePattern(pattern));

/**
 * What is one problem, as in vision's project settings: the project ids are
 * made for, where the screen title is, when two issues of a rule are the same
 * problem, and classes of problems with their own grouping or to ignore.
 */
const ProblemSettings = ({problems, onChange}) => {
  const {t} = useTranslation();
  const set = (patch) => onChange({...problems, ...patch});
  const setClass = (id, patch) =>
    set({classes: problems.classes.map((item) => (item.id === id ? {...item, ...patch} : item))});
  const setCondition = (id, field, values) => {
    const item = problems.classes.find((problemClass) => problemClass.id === id);
    setClass(id, {when: {...item.when, [field]: values}});
  };

  return (
    <div className={styles.problemSettings}>
      <Form layout="vertical">
        <Form.Item label={t('a11yProblemProject')} extra={t('a11yProblemProjectHint')}>
          <Input
            value={problems.projectId}
            placeholder={t('a11yProblemProjectPlaceholder')}
            onChange={(e) => set({projectId: e.target.value})}
          />
        </Form.Item>
        <Form.Item label={t('a11yScreenTitleSelectors')} extra={t('a11yScreenTitleSelectorsHint')}>
          <Select mode="tags" value={problems.screenTitle} onChange={(screenTitle) => set({screenTitle})} />
        </Form.Item>
      </Form>

      <div className={styles.settingsHeading}>{t('a11yDuplicateModes')}</div>
      <Table
        size="small"
        pagination={false}
        rowKey="rule"
        dataSource={A11Y_RULES.map((rule) => ({rule}))}
        columns={[
          {title: t('a11ySettingsRules'), key: 'rule', render: (_, {rule}) => t(`a11yRule_${rule}`)},
          {
            key: 'mode',
            width: 260,
            render: (_, {rule}) => (
              <Select
                size="small"
                style={{width: '100%'}}
                value={problems.duplicateModes[rule] ?? DEFAULT_DUPLICATE_MODES[rule] ?? 'screen'}
                onChange={(mode) => set({duplicateModes: {...problems.duplicateModes, [rule]: mode}})}
                options={MODES.map((mode) => ({value: mode, label: t(`a11yDuplicateMode_${mode}`)}))}
              />
            ),
          },
        ]}
      />

      <div className={styles.settingsHeading}>
        {t('a11yProblemClasses')}
        <Button
          size="small"
          icon={<IconPlus size={14} />}
          onClick={() =>
            set({
              classes: [
                ...problems.classes,
                {
                  id: newId(),
                  name: t('a11yProblemClassNew'),
                  rules: [],
                  when: {element: []},
                  groupBy: 'component',
                  action: 'report',
                },
              ],
            })
          }
        >
          {t('a11yProblemClassAdd')}
        </Button>
      </div>
      <div className={styles.muted}>{t('a11yProblemClassesHint')}</div>
      <Space orientation="vertical" style={{width: '100%', marginTop: 8}}>
        {problems.classes.map((item) => (
          <Card
            key={item.id}
            size="small"
            title={
              <Input
                variant="borderless"
                value={item.name}
                onChange={(e) => setClass(item.id, {name: e.target.value})}
              />
            }
            extra={
              <Tooltip title={t('a11yProblemClassDelete')}>
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<IconTrash size={14} />}
                  onClick={() => set({classes: problems.classes.filter((other) => other.id !== item.id)})}
                />
              </Tooltip>
            }
          >
            <Form layout="vertical" size="small">
              <Form.Item label={t('a11yProblemClassRules')}>
                <Select
                  mode="multiple"
                  allowClear
                  placeholder={t('a11yRuleAll')}
                  value={item.rules ?? []}
                  onChange={(rules) => setClass(item.id, {rules})}
                  options={A11Y_RULES.map((rule) => ({value: rule, label: t(`a11yRule_${rule}`)}))}
                />
              </Form.Item>
              {CONDITION_FIELDS.map((field) => {
                const values = item.when?.[field] ?? (field === 'element' && item.match ? [item.match] : []);
                const invalid = invalidPatterns(values);
                return (
                  <Form.Item
                    key={field}
                    label={t(`a11yProblemClassWhen_${field}`)}
                    validateStatus={invalid.length ? 'error' : ''}
                    help={invalid.length ? t('a11ySettingsInvalidPattern') : null}
                  >
                    <Select
                      mode="tags"
                      value={values}
                      placeholder={CONDITION_EXAMPLES[field]}
                      onChange={(next) => setCondition(item.id, field, next)}
                    />
                  </Form.Item>
                );
              })}
              <Space wrap>
                <Form.Item label={t('a11yProblemClassGroupBy')}>
                  <Select
                    style={{width: 240}}
                    value={item.groupBy ?? item.mode ?? 'component'}
                    onChange={(groupBy) => setClass(item.id, {groupBy})}
                    options={GROUPINGS.map((mode) => ({value: mode, label: t(`a11yDuplicateMode_${mode}`)}))}
                  />
                </Form.Item>
                <Form.Item label={t('a11yProblemClassAction')}>
                  <Select
                    style={{width: 200}}
                    value={item.action ?? 'report'}
                    onChange={(action) => setClass(item.id, {action})}
                    options={['report', 'ignore'].map((action) => ({
                      value: action,
                      label: t(`a11yProblemClassAction_${action}`),
                    }))}
                  />
                </Form.Item>
              </Space>
            </Form>
          </Card>
        ))}
      </Space>
    </div>
  );
};

export default ProblemSettings;
