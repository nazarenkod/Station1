import {
  IconBrandGitlab,
  IconChevronDown,
  IconLock,
  IconPlugConnected,
  IconSparkles,
  IconTicket,
} from '@tabler/icons-react';
import {Alert, App, Button, Form} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useLocation} from 'react-router';

import {backend} from '../../polyfills.js';
import {AiSettingsFields, useAiSettings} from '../AiSettings/AiSettingsModal.jsx';
import {Stagger, StaggerItem} from '../AppShell/motion.jsx';
import {JiraSettingsFields, useJiraSettings} from '../Jira/JiraSettingsModal.jsx';
import ChangeLanguage from '../SessionBuilder/AppSettings/ChangeLanguage.jsx';
import ToggleTheme from '../SessionBuilder/AppSettings/ToggleTheme.jsx';
import BuildSourcesSettings from './BuildSourcesSettings.jsx';
import {GitLabSettingsFields, useGitLabSettings} from './GitLabSettings.jsx';
import IosSigningSettings from './IosSigningSettings.jsx';

import styles from './SettingsPage.module.css';

const SECTIONS = ['integrations', 'builds', 'devices', 'general'];

/**
 * One outside service as a single line: what it is, what it is connected to
 * (or what it is for), and whether it works. A click opens its fields, with
 * saving, checking and disconnecting at the bottom.
 */
const IntegrationCard = ({
  icon,
  tone,
  title,
  purpose,
  summary,
  connected,
  settings,
  available,
  open,
  onToggle,
  children,
}) => {
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
    <section className={`${styles.card} ${open ? styles.cardOpen : ''}`} aria-label={title}>
      <button type="button" className={styles.cardHead} aria-expanded={open} onClick={onToggle}>
        <span className={`${styles.logo} ${styles[`logo_${tone}`]}`}>
          <Icon size={18} stroke={1.7} />
        </span>
        <span className={styles.cardTitleBlock}>
          <span className={styles.cardTitle}>{title}</span>
          <span className={styles.cardPurpose}>{connected && summary ? summary : purpose}</span>
        </span>
        <span className={`${styles.status} ${connected ? styles.statusOn : ''}`}>
          <span className={styles.statusDot} />
          {connected ? t('settingsConnected') : t('settingsNotConnected')}
        </span>
        <IconChevronDown size={16} className={styles.chevron} aria-hidden="true" />
      </button>
      {open &&
        (available ? (
          <>
            <div className={styles.cardBody}>{children}</div>
            <div className={styles.cardFoot}>
              <Button type="primary" loading={saving} onClick={save}>
                {t('jiraSave')}
              </Button>
              <Button
                icon={<IconPlugConnected size={16} />}
                loading={settings.testing}
                onClick={() => settings.runTest()}
              >
                {t('settingsCheck')}
              </Button>
              {connected && (
                <Button danger type="text" className={styles.disconnect} onClick={() => settings.disconnect()}>
                  {t('settingsDisconnect')}
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className={styles.cardBody}>
            <Alert type="info" showIcon title={t('jiraDesktopOnly')} />
          </div>
        ))}
    </section>
  );
};

const host = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url ?? '';
  }
};

const Integrations = () => {
  const {t} = useTranslation();
  const jira = useJiraSettings(true);
  const gitlab = useGitLabSettings(true);
  const ai = useAiSettings(true);
  const aiProvider = Form.useWatch('provider', ai.form);
  const aiModel = Form.useWatch('model', ai.form);
  const jiraUrl = Form.useWatch('url', jira.form);
  const jiraEmail = Form.useWatch('email', jira.form);
  const gitlabUrl = Form.useWatch('url', gitlab.form);
  const gitlabProject = Form.useWatch('project', gitlab.form);
  // one service open at a time keeps the page short
  const [open, setOpen] = useState(null);
  const toggle = (key) => () => setOpen((current) => (current === key ? null : key));
  const summary = (...parts) => parts.filter(Boolean).join(' · ');

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
          summary={summary(host(jiraUrl), jiraEmail)}
          connected={jira.hasToken}
          settings={jira}
          available={!!backend.jira}
          open={open === 'jira'}
          onToggle={toggle('jira')}
        >
          <JiraSettingsFields settings={jira} inlineTest={false} />
        </IntegrationCard>
      </StaggerItem>
      <StaggerItem>
        <IntegrationCard
          icon={IconBrandGitlab}
          tone="gitlab"
          title="GitLab"
          purpose={t('settingsGitlabPurpose')}
          summary={summary(host(gitlabUrl), gitlabProject)}
          connected={gitlab.hasToken}
          settings={gitlab}
          available={!!backend.gitlab}
          open={open === 'gitlab'}
          onToggle={toggle('gitlab')}
        >
          <GitLabSettingsFields settings={gitlab} inlineTest={false} />
        </IntegrationCard>
      </StaggerItem>
      <StaggerItem>
        <IntegrationCard
          icon={IconSparkles}
          tone="ai"
          title={t('settingsAiTitle')}
          purpose={t('settingsAiPurpose')}
          summary={summary(aiProvider === 'kiro' ? 'Kiro CLI' : 'Gemini', aiModel)}
          connected={aiProvider === 'kiro' || (aiProvider === 'gemini' && ai.hasKey)}
          settings={ai}
          available={!!backend.ai}
          open={open === 'ai'}
          onToggle={toggle('ai')}
        >
          <AiSettingsFields settings={ai} inlineTest={false} />
        </IntegrationCard>
      </StaggerItem>
    </Stagger>
  );
};

const Devices = () => {
  const {t} = useTranslation();
  return (
    <Stagger className={styles.section}>
      <StaggerItem>
        <h2 className={styles.sectionTitle}>{t('settingsDevices')}</h2>
        <p className={styles.sectionText}>{t('settingsDevicesText')}</p>
      </StaggerItem>
      <StaggerItem>
        <IosSigningSettings />
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

const Builds = ({openProject}) => {
  const {t} = useTranslation();
  return (
    <Stagger className={styles.section}>
      <StaggerItem>
        <h2 className={styles.sectionTitle}>{t('settingsBuilds')}</h2>
        <p className={styles.sectionText}>{t('settingsBuildsText')}</p>
      </StaggerItem>
      <StaggerItem>
        <BuildSourcesSettings openProject={openProject} />
      </StaggerItem>
    </Stagger>
  );
};

const PAGES = {integrations: Integrations, builds: Builds, devices: Devices, general: General};

/**
 * The workstation's settings: outside services and their keys, language and look.
 */
const SettingsPage = () => {
  const {t} = useTranslation();
  // another screen can open a section of its own: the session start opens the devices
  const {state} = useLocation();
  const [section, setSection] = useState(SECTIONS.includes(state?.section) ? state.section : 'integrations');
  const Page = PAGES[section];

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
        <div className={styles.content}>
          <Page openProject={state?.project ?? null} />
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
