import {IconCircleCheck, IconPlugConnected} from '@tabler/icons-react';
import {Alert, Button, Form, Input, Space} from 'antd';
import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {GITLAB_CONFIG} from '../../../shared/setting-defs.js';
import {backend, getSetting, openLink, setSetting} from '../../polyfills.js';

const TOKEN_PAGE_PATH = '/-/user_settings/personal_access_tokens';

/**
 * The GitLab settings form state. The access token goes straight to the
 * system keychain.
 */
export function useGitLabSettings(active) {
  const [form] = Form.useForm();
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!active || !backend.gitlab) {
      return;
    }
    (async () => {
      form.setFieldsValue({url: '', project: '', ...((await getSetting(GITLAB_CONFIG)) ?? {})});
      setHasToken(await backend.gitlab.hasToken());
      setToken('');
      setTest(null);
    })();
  }, [active, form]);

  const save = useCallback(async () => {
    const values = await form.validateFields();
    const url = values.url.trim().replace(/\/+$/, '');
    await setSetting(GITLAB_CONFIG, {
      url: url && !url.startsWith('http') ? `https://${url}` : url,
      project: values.project?.trim() ?? '',
    });
    if (token.trim()) {
      await backend.gitlab.setToken(token.trim());
      setHasToken(true);
      setToken('');
    }
  }, [form, token]);

  const runTest = useCallback(async () => {
    setTesting(true);
    try {
      await save();
      setTest(await backend.gitlab.test());
    } finally {
      setTesting(false);
    }
  }, [save]);

  const disconnect = useCallback(async () => {
    await backend.gitlab.setToken('');
    setHasToken(false);
    setTest(null);
  }, []);

  return {form, token, setToken, hasToken, test, testing, save, runTest, disconnect};
}

/**
 * The GitLab site, the access token and the project whose pipelines build the app.
 */
export const GitLabSettingsFields = ({settings, inlineTest = true}) => {
  const {t} = useTranslation();
  const {form, token, setToken, hasToken, test, testing, runTest} = settings;
  const url = Form.useWatch('url', form);

  return (
    <>
      <Form form={form} layout="vertical" requiredMark={false}>
        <Space.Compact block>
          <Form.Item
            name="url"
            label={t('gitlabSite')}
            rules={[{required: true, message: t('gitlabSiteRequired')}]}
            style={{flex: 1}}
          >
            <Input placeholder="https://gitlab.company.com" />
          </Form.Item>
          <Form.Item
            name="project"
            label={t('gitlabProject')}
            extra={t('gitlabProjectHint')}
            style={{flex: 1, marginLeft: 8}}
          >
            <Input placeholder="mobile/app-android" />
          </Form.Item>
        </Space.Compact>
        <Form.Item
          label={t('gitlabToken')}
          extra={
            <Space size={4} wrap>
              <span>{t('gitlabTokenScope')}</span>
              {url && (
                <Button
                  type="link"
                  size="small"
                  style={{padding: 0}}
                  onClick={() => openLink(`${url.replace(/\/+$/, '')}${TOKEN_PAGE_PATH}`)}
                >
                  {t('gitlabTokenWhere')}
                </Button>
              )}
            </Space>
          }
        >
          <Input.Password
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={hasToken ? t('jiraTokenSaved') : 'glpat-…'}
            autoComplete="new-password"
            prefix={hasToken && !token ? <IconCircleCheck size={16} color="#22C55E" /> : null}
          />
        </Form.Item>
      </Form>
      <Space orientation="vertical" style={{width: '100%'}}>
        {inlineTest && (
          <Button icon={<IconPlugConnected size={16} />} loading={testing} onClick={runTest}>
            {t('jiraTest')}
          </Button>
        )}
        {test && (
          <Alert
            type={test.ok ? 'success' : 'error'}
            showIcon
            title={
              test.ok
                ? t(test.project ? 'gitlabTestOkProject' : 'gitlabTestOk', {user: test.user, project: test.project})
                : t('jiraTestFailed', {error: test.error})
            }
          />
        )}
      </Space>
    </>
  );
};
