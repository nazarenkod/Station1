import {IconDownload, IconRestore, IconUpload} from '@tabler/icons-react';
import {Button, Form, Input, InputNumber, Modal, Segmented, Space, Switch, Table, Tabs} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {DEFAULT_A11Y_CONFIG, isValidPattern, mergeConfig} from '../../../lib/a11y/config';
import {compilePattern} from '../../../lib/a11y/problems';
import {A11Y_RULES} from '../../../lib/a11y/types';
import {downloadText, pickFiles, readTextFromUploadedFiles} from '../../../utils/file-handling.js';
import {notification} from '../../../utils/notification.js';
import ProblemSettings from './ProblemSettings.jsx';

const SEVERITIES = ['error', 'warning', 'info'];

/**
 * Which rules run, how severe each is, and the numbers and patterns they use.
 * The config can be exported and shared, so a whole team checks the same way.
 */
const RulesModal = ({open, config, onClose, onSave}) => {
  const {t} = useTranslation();
  const [draft, setDraft] = useState(config ?? DEFAULT_A11Y_CONFIG);

  useEffect(() => {
    if (open) {
      setDraft(structuredClone(config ?? DEFAULT_A11Y_CONFIG));
    }
  }, [open, config]);

  const setRule = (rule, patch) =>
    setDraft((prev) => ({...prev, rules: {...prev.rules, [rule]: {...prev.rules[rule], ...patch}}}));
  const setThreshold = (key, value) =>
    setDraft((prev) => ({
      ...prev,
      thresholds: {...prev.thresholds, [key]: value ?? DEFAULT_A11Y_CONFIG.thresholds[key]},
    }));
  const setPattern = (key, value) => setDraft((prev) => ({...prev, patterns: {...prev.patterns, [key]: value}}));

  const patternsValid =
    Object.values(draft.patterns).every(isValidPattern) &&
    draft.problems.classes.every((item) =>
      Object.values(item.when ?? {}).every((values) => (values ?? []).every((pattern) => !!compilePattern(pattern))),
    );

  const importConfig = async () => {
    const [file] = await readTextFromUploadedFiles(await pickFiles());
    if (!file) {
      return;
    }
    try {
      const parsed = JSON.parse(file.content);
      if (!parsed.rules && !parsed.thresholds) {
        throw new Error('not a config');
      }
      setDraft(mergeConfig(parsed));
    } catch {
      notification.error({title: t('a11ySettingsInvalidFile')});
    }
  };

  const ruleRows = A11Y_RULES.map((rule) => ({key: rule, rule, ...draft.rules[rule]}));

  const rulesTab = (
    <Table
      size="small"
      pagination={false}
      dataSource={ruleRows}
      scroll={{y: 420}}
      columns={[
        {
          key: 'enabled',
          width: 60,
          render: (_, row) => (
            <Switch size="small" checked={row.enabled} onChange={(enabled) => setRule(row.rule, {enabled})} />
          ),
        },
        {
          title: t('a11ySettingsRules'),
          key: 'rule',
          render: (_, row) => (
            <div>
              <div>{t(`a11yRule_${row.rule}`)}</div>
              <code style={{fontSize: 11, opacity: 0.6}}>{row.rule}</code>
            </div>
          ),
        },
        {
          key: 'severity',
          width: 290,
          render: (_, row) => (
            <Segmented
              size="small"
              disabled={!row.enabled}
              value={row.severity}
              onChange={(severity) => setRule(row.rule, {severity})}
              options={SEVERITIES.map((value) => ({value, label: t(`a11ySeverity_${value}`)}))}
            />
          ),
        },
      ]}
    />
  );

  const thresholdsTab = (
    <Form layout="vertical">
      {Object.keys(DEFAULT_A11Y_CONFIG.thresholds).map((key) => (
        <Form.Item key={key} label={t(`a11yThreshold_${key}`)} style={{marginBottom: 12}}>
          <InputNumber
            min={0}
            step={key === 'maxControlScreenShare' ? 0.05 : key.includes('Contrast') ? 0.1 : 1}
            value={draft.thresholds[key]}
            onChange={(value) => setThreshold(key, value)}
            style={{width: 160}}
          />
        </Form.Item>
      ))}
    </Form>
  );

  const patternsTab = (
    <Form layout="vertical">
      {Object.keys(DEFAULT_A11Y_CONFIG.patterns).map((key) => {
        const valid = isValidPattern(draft.patterns[key]);
        return (
          <Form.Item
            key={key}
            label={t(`a11yPattern_${key}`)}
            validateStatus={valid ? '' : 'error'}
            help={valid ? null : t('a11ySettingsInvalidPattern')}
          >
            <Input.TextArea
              autoSize={{minRows: 1, maxRows: 4}}
              value={draft.patterns[key]}
              onChange={(e) => setPattern(key, e.target.value)}
              style={{fontFamily: 'var(--ant-font-family-code)'}}
            />
          </Form.Item>
        );
      })}
    </Form>
  );

  return (
    <Modal
      open={open}
      title={t('a11ySettingsTitle')}
      width={760}
      onCancel={onClose}
      onOk={() => onSave(draft)}
      okButtonProps={{disabled: !patternsValid}}
      centered
      destroyOnHidden
      footer={(_, {OkBtn, CancelBtn}) => (
        <Space style={{width: '100%', justifyContent: 'space-between'}}>
          <Space>
            <Button icon={<IconRestore size={14} />} onClick={() => setDraft(structuredClone(DEFAULT_A11Y_CONFIG))}>
              {t('a11ySettingsReset')}
            </Button>
            <Button icon={<IconUpload size={14} />} onClick={importConfig}>
              {t('a11ySettingsImport')}
            </Button>
            <Button
              icon={<IconDownload size={14} />}
              onClick={() => downloadText('vision-a11y-rules.json', JSON.stringify(draft, null, 2))}
            >
              {t('a11ySettingsExport')}
            </Button>
          </Space>
          <Space>
            <CancelBtn />
            <OkBtn />
          </Space>
        </Space>
      )}
    >
      <Tabs
        items={[
          {key: 'rules', label: t('a11ySettingsRules'), children: rulesTab},
          {key: 'thresholds', label: t('a11ySettingsThresholds'), children: thresholdsTab},
          {key: 'patterns', label: t('a11ySettingsPatterns'), children: patternsTab},
          {
            key: 'problems',
            label: t('a11ySettingsProblems'),
            children: (
              <ProblemSettings
                problems={draft.problems}
                onChange={(problems) => setDraft((prev) => ({...prev, problems}))}
              />
            ),
          },
        ]}
      />
    </Modal>
  );
};

export default RulesModal;
