import {IconCircleCheck, IconPlugConnected} from '@tabler/icons-react';
import {Alert, Button, Form, Input, Modal, Select, Space} from 'antd';
import {useEffect, useState} from 'react';
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
 * The Jira Cloud site, the account that files bugs and the bug defaults. The
 * API token goes straight to the system keychain and is never shown again.
 */
const JiraSettingsModal = ({open, onClose, onSaved}) => {
  const {t} = useTranslation();
  const [form] = Form.useForm();
  const [hasToken, setHasToken] = useState(false);
  const [token, setToken] = useState('');
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!open || !backend.available) {
      return;
    }
    (async () => {
      form.setFieldsValue(await loadJiraSettings());
      setHasToken(await backend.jira.hasToken());
      setToken('');
      setTest(null);
    })();
  }, [open, form]);

  const save = async () => {
    const values = await form.validateFields();
    const url = values.url.trim().replace(/\/+$/, '');
    await setSetting(JIRA_CONFIG, {...JIRA_DEFAULTS, ...values, url: url.startsWith('http') ? url : `https://${url}`});
    if (token.trim()) {
      await backend.jira.setToken(token.trim());
      setHasToken(true);
      setToken('');
    }
  };

  const runTest = async () => {
    setTesting(true);
    try {
      await save();
      setTest(await backend.jira.test());
    } finally {
      setTesting(false);
    }
  };

  if (!backend.available) {
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
        await save();
        onSaved?.();
        onClose();
      }}
      okText={t('jiraSave')}
      width={560}
      centered
      destroyOnHidden
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="url" label={t('jiraSite')} rules={[{required: true, message: t('jiraSiteRequired')}]}>
          <Input placeholder="https://your-company.atlassian.net" />
        </Form.Item>
        <Form.Item
          name="email"
          label={t('jiraEmail')}
          rules={[{required: true, type: 'email', message: t('jiraEmailRequired')}]}
        >
          <Input placeholder="name@company.com" autoComplete="off" />
        </Form.Item>
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
    </Modal>
  );
};

export default JiraSettingsModal;
