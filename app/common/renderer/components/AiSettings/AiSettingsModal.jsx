import {IconCircleCheck, IconPlugConnected, IconSparkles} from '@tabler/icons-react';
import {Alert, Button, Form, Input, InputNumber, Modal, Segmented, Select, Space, Switch} from 'antd';
import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {AI_CONFIG} from '../../../shared/setting-defs.js';
import {backend, getSetting, openLink, setSetting} from '../../polyfills.js';

export const AI_DEFAULTS = {
  provider: 'none',
  model: '',
  consent: false,
  dailyLimit: 200,
  maskPatterns: [
    '\\b\\d{4}[ -]?\\d{2,4}[ -]?\\d{2,4}[ -]?\\d{4}\\b',
    '\\bUA\\d{2}[ \\d]{20,}\\b',
    '\\+?\\d[\\d ()-]{8,}\\d',
    '[\\w.+-]+@[\\w-]+\\.[\\w.]+',
  ],
};

const MODEL_HINT = {gemini: 'gemini-flash-lite-latest', kiro: 'kiro-cli default'};
const GEMINI_KEY_PAGE = 'https://aistudio.google.com/apikey';

/**
 * The AI settings form state: loaded when `active` turns on, saved on demand.
 * The Gemini key goes straight to the system keychain.
 */
export function useAiSettings(active) {
  const [form] = Form.useForm();
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!active || !backend.ai) {
      return;
    }
    (async () => {
      form.setFieldsValue({...AI_DEFAULTS, ...((await getSetting(AI_CONFIG)) ?? {})});
      setHasKey(await backend.ai.hasKey());
      setKey('');
      setTest(null);
    })();
  }, [active, form]);

  const save = useCallback(async () => {
    const values = await form.validateFields();
    await setSetting(AI_CONFIG, {...AI_DEFAULTS, ...values});
    if (key.trim()) {
      await backend.ai.setKey(key.trim());
      setHasKey(true);
      setKey('');
    }
  }, [form, key]);

  const runTest = useCallback(async () => {
    setTesting(true);
    try {
      await save();
      setTest(await backend.ai.test());
    } finally {
      setTesting(false);
    }
  }, [save]);

  const disconnect = useCallback(async () => {
    await backend.ai.setKey('');
    setHasKey(false);
    setTest(null);
  }, []);

  return {form, key, setKey, hasKey, test, testing, save, runTest, disconnect};
}

/**
 * Which model looks at screens (Gemini with an API key, or Kiro CLI with the
 * account it is signed in to), what never leaves the machine, and how much a day.
 */
export const AiSettingsFields = ({settings}) => {
  const {t} = useTranslation();
  const {form, key, setKey, hasKey, test, testing, runTest} = settings;
  const provider = Form.useWatch('provider', form);

  return (
    <Form form={form} layout="vertical" requiredMark={false}>
      <Form.Item name="provider" label={t('aiProvider')}>
        <Segmented
          block
          options={[
            {value: 'none', label: t('aiProvider_none')},
            {value: 'gemini', label: 'Gemini'},
            {value: 'kiro', label: 'Kiro CLI'},
          ]}
        />
      </Form.Item>
      {provider && provider !== 'none' && (
        <>
          <Form.Item name="model" label={t('aiModel')} extra={t(`aiProviderHint_${provider}`)}>
            <Input placeholder={MODEL_HINT[provider]} />
          </Form.Item>
          {provider === 'gemini' && (
            <Form.Item
              label={t('aiKey')}
              extra={
                <Button type="link" size="small" style={{padding: 0}} onClick={() => openLink(GEMINI_KEY_PAGE)}>
                  {t('aiKeyWhere')}
                </Button>
              }
            >
              <Input.Password
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={hasKey ? t('jiraTokenSaved') : t('aiKeyPlaceholder')}
                autoComplete="new-password"
                prefix={hasKey && !key ? <IconCircleCheck size={16} color="#22C55E" /> : null}
              />
            </Form.Item>
          )}
          <Form.Item name="maskPatterns" label={t('aiMask')} extra={t('aiMaskHint')}>
            <Select mode="tags" tokenSeparators={['\n']} />
          </Form.Item>
          <Space size="large" align="start">
            <Form.Item name="dailyLimit" label={t('aiDailyLimit')}>
              <InputNumber min={1} max={10000} />
            </Form.Item>
            <Form.Item name="consent" label={t('aiConsentSwitch')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          <Space orientation="vertical" style={{width: '100%'}}>
            <Button icon={<IconPlugConnected size={16} />} loading={testing} onClick={runTest}>
              {t('aiTest')}
            </Button>
            {test && (
              <Alert
                type={test.ok ? 'success' : 'error'}
                showIcon
                title={
                  test.ok
                    ? t('aiTestOk', {model: test.model || provider})
                    : t('aiTestFailed', {error: test.error === 'consent' ? t('aiConsentNeeded') : test.error})
                }
              />
            )}
          </Space>
        </>
      )}
    </Form>
  );
};

const AiSettingsModal = ({open, onClose, onSaved}) => {
  const {t} = useTranslation();
  const settings = useAiSettings(open);

  if (!backend.ai) {
    return (
      <Modal open={open} onCancel={onClose} footer={null} title={t('aiSettings')}>
        <Alert type="info" showIcon title={t('aiDesktopOnly')} />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={
        <Space>
          <IconSparkles size={18} />
          {t('aiSettings')}
        </Space>
      }
      onCancel={onClose}
      onOk={async () => {
        await settings.save();
        onSaved?.();
        onClose();
      }}
      okText={t('jiraSave')}
      width={600}
      centered
      destroyOnHidden
    >
      <AiSettingsFields settings={settings} />
    </Modal>
  );
};

export default AiSettingsModal;
