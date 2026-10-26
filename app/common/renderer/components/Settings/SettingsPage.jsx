import {IconBrandGitlab, IconLock, IconSparkles, IconTicket} from '@tabler/icons-react';
import {Alert, App, Button, Form} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';

import {backend} from '../../polyfills.js';
import {AiSettingsFields, useAiSettings} from '../AiSettings/AiSettingsModal.jsx';
import {Stagger, StaggerItem} from '../AppShell/motion.jsx';
import {JiraSettingsFields, useJiraSettings} from '../Jira/JiraSettingsModal.jsx';
import ChangeLanguage from '../SessionBuilder/AppSettings/ChangeLanguage.jsx';
import ToggleTheme from '../SessionBuilder/AppSettings/ToggleTheme.jsx';
import {GitLabSettingsFields, useGitLabSettings} from './GitLabSettings.jsx';

import styles from './SettingsPage.module.css';

const SECTIONS = ['integrations', 'general'];

/**
 * One outside service: what it is for, whether it is connected, its fields.
 */
const IntegrationCard = ({icon, tone, title, purpose, connected, settings, available, children}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const [saving, setSaving] = useState(false);
  const Icon = icon;

  const save = async () => {
    setSaving(true);
    try {
      await settings.save();
      message.success(t('settingsSaved'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.card} aria-label={title}>
      <div className={styles.cardHead}>
        <span className={`${styles.logo} ${styles[`logo_${tone}`]}`}>
          <Icon size={20} stroke={1.7} />
        </span>
        <div className={styles.cardTitleBlock}>
          <span className={styles.cardTitle}>{title}</span>
          <span className={styles.cardPurpose}>{purpose}</span>
        </div>
        <span className={`${styles.status} ${connected ? styles.statusOn : ''}`}>
          <span className={styles.statusDot} />
          {connected ? t('settingsConnected') : t('settingsNotConnected')}
        </span>
      </div>
      {available ? (
        <>
          <div className={styles.cardBody}>{children}</div>
          <div className={styles.cardFoot}>
            <Button type="primary" loading={saving} onClick={save}>
              {t('jiraSave')}
            </Button>
            {connected && (
              <Button danger type="text" onClick={() => settings.disconnect()}>
                {t('settingsDisconnect')}
              </Button>
            )}
          </div>
        </>
      ) : (
        <div className={styles.cardBody}>
          <Alert type="info" showIcon title={t('jiraDesktopOnly')} />
        </div>
      )}
    </section>
  );
};

const Integrations = () => {
  const {t} = useTranslation();
  const jira = useJiraSettings(true);
  const gitlab = useGitLabSettings(true);
  const ai = useAiSettings(true);
  const aiProvider = Form.useWatch('provider', ai.form);

  return (
    <Stagger className={styles.section}>
      <StaggerItem>
        <h2 className={styles.sectionTitle}>{t('settingsIntegrations')}</h2>
        <p className={styles.sectionText}>{t('settingsIntegrationsText')}</p>
      </StaggerItem>
      <StaggerItem className={styles.vault}>
        <IconLock size={18} stroke={1.7} />
        <span>{t('settingsVault')}</span>
      </StaggerItem>
      <StaggerItem>
        <IntegrationCard
          icon={IconTicket}
          tone="jira"
          title="Jira Cloud"
          purpose={t('settingsJiraPurpose')}
          connected={jira.hasToken}
          settings={jira}
          available={!!backend.jira}
        >
          <JiraSettingsFields settings={jira} />
        </IntegrationCard>
      </StaggerItem>
      <StaggerItem>
        <IntegrationCard
          icon={IconBrandGitlab}
          tone="gitlab"
          title="GitLab"
          purpose={t('settingsGitlabPurpose')}
          connected={gitlab.hasToken}
          settings={gitlab}
          available={!!backend.gitlab}
        >
          <GitLabSettingsFields settings={gitlab} />
        </IntegrationCard>
      </StaggerItem>
      <StaggerItem>
        <IntegrationCard
          icon={IconSparkles}
          tone="ai"
          title={t('settingsAiTitle')}
          purpose={t('settingsAiPurpose')}
          connected={aiProvider === 'kiro' || (aiProvider === 'gemini' && ai.hasKey)}
          settings={ai}
          available={!!backend.ai}
        >
          <AiSettingsFields settings={ai} />
        </IntegrationCard>
      </StaggerItem>
    </Stagger>
  );
};

const General = () => {
  const {t} = useTranslation();
  return (
    <Stagger className={styles.section}>
      <StaggerItem>
        <h2 className={styles.sectionTitle}>{t('settingsGeneral')}</h2>
      </StaggerItem>
      <StaggerItem className={styles.card}>
        <div className={styles.cardBody}>
          <Form layout="vertical">
            <ChangeLanguage />
            <ToggleTheme />
          </Form>
        </div>
      </StaggerItem>
    </Stagger>
  );
};

/**
 * The workstation's settings: outside services and their keys, language and look.
 */
const SettingsPage = () => {
  const {t} = useTranslation();
  const [section, setSection] = useState('integrations');

  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <nav className={styles.nav} aria-label={t('wsSettings')}>
          <h1 className={styles.title}>{t('wsSettings')}</h1>
          {SECTIONS.map((key) => (
            <button
              key={key}
              className={`${styles.navItem} ${section === key ? styles.navItemActive : ''}`}
              aria-current={section === key ? 'page' : undefined}
              onClick={() => setSection(key)}
            >
              {t(`settingsSection_${key}`)}
            </button>
          ))}
        </nav>
        <div className={styles.content}>{section === 'integrations' ? <Integrations /> : <General />}</div>
      </div>
    </div>
  );
};

export default SettingsPage;
