import {IconCircleCheck, IconPlugConnected} from '@tabler/icons-react';
import {Alert, Button, Form, Input, Modal, Select, Space} from 'antd';
import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {JIRA_CONFIG} from '../../../shared/setting-defs.js';
import {backend, getSetting, openLink, setSetting} from '../../polyfills.js';

export const JIRA_DEFAULTS = {
  url: '',
  email: '',
  issueType: '',
  linkType: '',
  severity: 'S4',
  labels: ['accessibility', 'vision'],
  blocks: [],
};

const TOKEN_PAGE = 'https://id.atlassian.com/manage-profile/security/api-tokens';

export async function loadJiraSettings() {
  return {...JIRA_DEFAULTS, ...((await getSetting(JIRA_CONFIG)) ?? {})};
}

/**
 * The Jira settings form state: loaded when `active` turns on, saved on
 * demand. The API token goes straight to the system keychain.
 */
export function useJiraSettings(active) {
  const [form] = Form.useForm();
  const [hasToken, setHasToken] = useState(false);
  const [token, setToken] = useState('');
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!active || !backend.jira) {
      return;
    }
    (async () => {
      form.setFieldsValue(await loadJiraSettings());
      setHasToken(await backend.jira.hasToken());
      setToken('');
      setTest(null);
    })();
  }, [active, form]);

  const save = useCallback(async () => {
    const values = await form.validateFields();
    const url = values.url.trim().replace(/\/+$/, '');
    await setSetting(JIRA_CONFIG, {...JIRA_DEFAULTS, ...values, url: url.startsWith('http') ? url : `https://${url}`});
    if (token.trim()) {
      await backend.jira.setToken(token.trim());
      setHasToken(true);
      setToken('');
    }
  }, [form, token]);

  const runTest = useCallback(async () => {
    setTesting(true);
    try {
      await save();
      setTest(await backend.jira.test());
    } finally {
      setTesting(false);
    }
  }, [save]);

  const disconnect = useCallback(async () => {
    await backend.jira.setToken('');
    setHasToken(false);
    setTest(null);
  }, []);

  return {form, hasToken, token, setToken, test, testing, save, runTest, disconnect};
}

/**
 * The Jira Cloud site, the account that files bugs and the bug defaults.
 */
export const JiraSettingsFields = ({settings}) => {
  const {t} = useTranslation();
  const {form, hasToken, token, setToken, test, testing, runTest} = settings;

  return (
    <>
      <Form form={form} layout="vertical" requiredMark={false}>
        <Space.Compact block>
          <Form.Item
            name="url"
            label={t('jiraSite')}
            rules={[{required: true, message: t('jiraSiteRequired')}]}
            style={{flex: 1}}
          >
            <Input placeholder="https://your-company.atlassian.net" />
          </Form.Item>
          <Form.Item
            name="email"
            label={t('jiraEmail')}
            rules={[{required: true, type: 'email', message: t('jiraEmailRequired')}]}
            style={{flex: 1, marginLeft: 8}}
          >
            <Input placeholder="name@company.com" autoComplete="off" />
          </Form.Item>
        </Space.Compact>
        <Form.Item
          label={t('jiraToken')}
          extra={
            <Button type="link" size="small" style={{padding: 0}} onClick={() => openLink(TOKEN_PAGE)}>
              {t('jiraTokenWhere')}
            </Button>
          }
        >
          <Input.Password
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={hasToken ? t('jiraTokenSaved') : t('jiraTokenPlaceholder')}
            autoComplete="new-password"
            prefix={hasToken && !token ? <IconCircleCheck size={16} color="#22C55E" /> : null}
          />
        </Form.Item>
        <Space.Compact block>
          <Form.Item name="issueType" label={t('jiraDefaultIssueType')} style={{flex: 1}}>
            <Input placeholder={t('jiraDefaultIssueTypeHint')} />
          </Form.Item>
          <Form.Item name="linkType" label={t('jiraDefaultLinkType')} style={{flex: 1, marginLeft: 8}}>
            <Input placeholder="Relates" />
          </Form.Item>
          <Form.Item name="severity" label={t('jiraSeverity')} style={{width: 100, marginLeft: 8}}>
            <Input />
          </Form.Item>
        </Space.Compact>
        <Form.Item name="labels" label={t('jiraLabels')}>
          <Select mode="tags" tokenSeparators={[',', ' ']} />
        </Form.Item>
        <Form.Item name="blocks" label={t('jiraBlocks')} extra={t('jiraBlocksHint')}>
          <Select mode="tags" tokenSeparators={[';']} />
        </Form.Item>
      </Form>
      <Space orientation="vertical" style={{width: '100%'}}>
        <Button icon={<IconPlugConnected size={16} />} loading={testing} onClick={runTest}>
          {t('jiraTest')}
        </Button>
        {test && (
          <Alert
            type={test.ok ? 'success' : 'error'}
            showIcon
            title={test.ok ? t('jiraTestOk', {user: test.user}) : t('jiraTestFailed', {error: test.error})}
          />
        )}
      </Space>
    </>
  );
};

const JiraSettingsModal = ({open, onClose, onSaved}) => {
  const {t} = useTranslation();
  const settings = useJiraSettings(open);

  if (!backend.jira) {
    return (
      <Modal open={open} onCancel={onClose} footer={null} title={t('jiraSettings')}>
        <Alert type="info" showIcon title={t('jiraDesktopOnly')} />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={t('jiraSettings')}
      onCancel={onClose}
      onOk={async () => {
        await settings.save();
        onSaved?.();
        onClose();
      }}
      okText={t('jiraSave')}
      width={560}
      centered
      destroyOnHidden
    >
      <JiraSettingsFields settings={settings} />
    </Modal>
  );
};

export default JiraSettingsModal;
