import {
  IconBrain,
  IconCheck,
  IconDeviceMobile,
  IconDownload,
  IconPlugConnected,
  IconRestore,
} from '@tabler/icons-react';
import {App, Button, Input, InputNumber, Switch, Tag} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {formatCredits} from '../../../shared/agent/credits.js';
import {cleanServer, secretNames, serversFromJson, serversToJson} from '../../../shared/agent/mcp-servers.js';
import {AGENT_CONFIG, AGENT_CONSENT, AGENT_PROJECT, DEFAULT_SETTINGS} from '../../../shared/setting-defs.js';
import {refreshCredits, useAgent} from '../../lib/agent/agent-store.js';
import {useProfiles} from '../../lib/settings/profiles-store.js';
import {backend, getSetting, setSetting} from '../../polyfills.js';
import ExternalAgentsSettings from '../Autotests/ExternalAgentsSettings.jsx';
import MemorySettings from './MemorySettings.jsx';

import styles from './SettingsPage.module.css';

// a setting read again when `follow` changes (the project's part follows the profile)
const useSettingValue = (key, follow = null) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    getSetting(key).then((saved) => setValue({...DEFAULT_SETTINGS[key], ...(saved ?? {})}));
  }, [key, follow]);
  const save = async (patch) => {
    const next = {...value, ...patch};
    setValue(next);
    await setSetting(key, next);
  };
  return [value, save];
};

const JSON_EXAMPLE = `{
  "mcpServers": {
    "github": {"type": "http", "url": "https://api.githubcopilot.com/mcp/", "headers": {"Authorization": "Bearer …"}},
    "files": {"command": "npx", "args": ["-y", "@acme/mcp-server"], "env": {"API_TOKEN": "…"}}
  }
}`;

/** A server under the JSON: its state, whether a key is missing, and «Check». */
const ServerRow = ({server, status}) => {
  const {t} = useTranslation();
  const [saved, setSaved] = useState(null);
  const [check, setCheck] = useState(null);
  useEffect(() => {
    backend.agent.mcpSecretNames(server.id).then(setSaved);
  }, [server]);
  const runCheck = async () => {
    setCheck({running: true});
    setCheck(await backend.agent.testMcp(server));
  };
  const missing = saved ? secretNames(server).filter((name) => !saved.includes(name)) : [];
  const state = !server.enabled ? 'disabled' : status ? (status.failedAuthorization ? 'login' : status.status) : null;
  return (
    <div className={styles.mcpRow}>
      <b className={styles.mono}>{server.name}</b>
      <span className={styles.profileHint}>{t(`agentMcpKind_${server.kind}`)}</span>
      {state && <Tag>{t(`agentMcpState_${state}`, {defaultValue: state})}</Tag>}
      {missing.length > 0 && <Tag color="warning">{t('agentMcpNeedsKey', {names: missing.join(', ')})}</Tag>}
      <span className={styles.spacer} />
      {check?.ok && <span className={styles.profileHint}>{t('agentMcpTools', {count: check.tools.length})}</span>}
      {check && check.ok === false && (
        <span className={styles.sourceWarn} title={check.detail || undefined}>
          {t(`agentMcpError_${check.error}`, {defaultValue: t('agentMcpError_other')})}
        </span>
      )}
      <Button size="small" icon={<IconPlugConnected size={14} />} loading={check?.running} onClick={runCheck}>
        {t('agentMcpCheck')}
      </Button>
    </div>
  );
};

/**
 * The servers as one mcp.json, the format other agents use: pasted from
 * there as it is. Tokens and keys in it go to the keychain on saving and
 * show as <keychain> after.
 */
const ServerJson = ({servers, onChange, statuses}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const shown = serversToJson(servers);
  const [text, setText] = useState(shown);
  const [error, setError] = useState(null);
  // saved, or another profile: the field shows what is kept now
  useEffect(() => {
    setText(shown);
    setError(null);
  }, [shown]);

  const save = async () => {
    const result = serversFromJson(text, servers);
    if (!result.ok) {
      setError(t(`agentMcpJsonError_${result.error}`, {detail: result.detail ?? ''}));
      return;
    }
    for (const [serverId, values] of Object.entries(result.secrets)) {
      await backend.agent.setMcpSecrets(serverId, values);
    }
    setError(null);
    await onChange(result.servers);
    message.success(
      Object.keys(result.secrets).length
        ? t('agentMcpSavedWithKeys')
        : t('agentMcpSaved', {count: result.servers.length}),
    );
  };

  return (
    <div className={styles.profileApps}>
      <Input.TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoSize={{minRows: 4, maxRows: 24}}
        placeholder={JSON_EXAMPLE}
        spellCheck={false}
        className={styles.mono}
        status={error ? 'error' : undefined}
        aria-label={t('agentMcpJson')}
      />
      {error && <span className={styles.sourceWarn}>{error}</span>}
      <div className={styles.sourceActions}>
        <Button size="small" type="primary" icon={<IconCheck size={14} />} disabled={text === shown} onClick={save}>
          {t('Save')}
        </Button>
        {text !== shown && (
          <Button size="small" onClick={() => setText(shown)}>
            {t('Cancel')}
          </Button>
        )}
      </div>
      {servers.map((server) => (
        <ServerRow key={server.id} server={server} status={statuses.find((one) => one.name === server.name)} />
      ))}
    </div>
  );
};

/**
 * The agent's hands: appium-mcp in the station's folder, installed on
 * request since it is large, and how many actions a turn may take.
 */
const HandsSettings = ({limit, onLimit, extended, onExtended}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const [status, setStatus] = useState(null);
  useEffect(() => {
    backend.hands?.status().then(setStatus);
  }, []);
  if (!backend.hands || !status) {
    return null;
  }
  const install = async () => {
    setStatus({...status, installing: true});
    const result = await backend.hands.install();
    setStatus(result);
    message[result.ok ? 'success' : 'error'](t(result.ok ? 'agentHandsInstalled' : 'agentHandsInstallFailed'));
  };
  return (
    <section className={`${styles.card} ${styles.cardOpen}`}>
      <div className={styles.cardHead}>
        <span className={`${styles.logo} ${styles.logo_ai}`}>
          <IconDeviceMobile size={18} stroke={1.7} />
        </span>
        <span className={styles.cardTitleBlock}>
          <span className={styles.cardTitle}>{t('agentHandsSettings')}</span>
          <span className={styles.cardPurpose}>{t('agentHandsPurpose')}</span>
        </span>
        <span className={`${styles.status} ${status.installed ? styles.statusOn : ''}`}>
          <span className={styles.statusDot} />
          {status.installed ? t('agentHandsOn') : t('agentHandsOff')}
        </span>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.mcpRow}>
          <span className={`${styles.mono} ${styles.profileHint}`}>{status.spec}</span>
          <span className={styles.spacer} />
          <Button
            size="small"
            type={status.installed ? 'default' : 'primary'}
            icon={<IconDownload size={14} />}
            loading={status.installing}
            onClick={install}
          >
            {status.installed ? t('agentHandsReinstall') : t('agentHandsInstall')}
          </Button>
        </div>
        <div className={styles.agentNumbers}>
          <label>
            <span>{t('agentHandsLimit')}</span>
            <InputNumber min={5} step={10} value={limit} onChange={(value) => onLimit(value ?? 60)} />
          </label>
        </div>
        <label className={styles.mcpRow}>
          <Switch size="small" checked={extended} onChange={onExtended} />
          <span>{t('agentHandsExtended')}</span>
        </label>
        <span className={styles.profileHint}>{t('agentHandsHint')}</span>
      </div>
    </section>
  );
};

/** A text saved when the field is left, not on every key. */
const SavedText = ({value, onSave, rows = 4, placeholder}) => {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  return (
    <Input.TextArea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== (value ?? '') && onSave(text)}
      autoSize={{minRows: rows, maxRows: 24}}
      placeholder={placeholder}
      className={styles.mono}
    />
  );
};

/**
 * The station's agent: what it costs, how much it may read, its instructions
 * and the MCP servers it gets, for the station and for the project.
 */
const AgentSettings = () => {
  const {t, i18n} = useTranslation();
  const agent = useAgent();
  const profiles = useProfiles();
  const [config, saveConfig] = useSettingValue(AGENT_CONFIG);
  const [project, saveProject] = useSettingValue(AGENT_PROJECT, profiles.activeId);
  const [consent, saveConsent] = useSettingValue(AGENT_CONSENT);
  const [defaults, setDefaults] = useState(null);
  const language = i18n.language?.slice(0, 2) ?? 'uk';

  useEffect(() => {
    backend.agent?.defaults().then(setDefaults);
    refreshCredits();
  }, []);

  if (!config || !project || !consent || !backend?.agent) {
    return null;
  }
  const summary = agent.credits?.summary;
  const plan = agent.credits?.usage?.data;
  const credit = plan?.usageBreakdowns?.find((one) => one.resourceType === 'CREDIT');
  const files = agent.chat.context?.breakdown?.contextFiles?.items ?? [];
  const profileId = profiles.activeId;

  return (
    <div className={styles.profileApps}>
      <section className={`${styles.card} ${styles.cardOpen}`}>
        <div className={styles.cardHead}>
          <span className={`${styles.logo} ${styles.logo_ai}`}>
            <IconBrain size={18} stroke={1.7} />
          </span>
          <div className={styles.cardTitleBlock}>
            <span className={styles.cardTitle}>{t('agentCreditsTitle')}</span>
            <span className={styles.cardPurpose}>
              {credit
                ? t('agentPlan', {
                    plan: plan.planName,
                    used: formatCredits(credit.used, language),
                    limit: credit.limit,
                    reset: plan.billingCycleReset,
                  })
                : t('agentPlanUnknown')}
            </span>
          </div>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.agentStats}>
            <span>{t('agentCreditsToday', {credits: formatCredits(summary?.today ?? 0, language)})}</span>
            <span>{t('agentCreditsWeek', {credits: formatCredits(summary?.week ?? 0, language)})}</span>
            <span>
              {t('agentCreditsProfile', {credits: formatCredits(summary?.byProfile?.[profileId] ?? 0, language)})}
            </span>
            {summary?.unmetered > 0 && (
              <span className={styles.profileHint}>{t('agentCreditsUnmetered', {count: summary.unmetered})}</span>
            )}
          </div>
          <div className={styles.agentNumbers}>
            <label>
              <span>{t('agentDailyLimit')}</span>
              <InputNumber
                min={0}
                step={1}
                value={config.dailyCreditLimit}
                onChange={(value) => saveConfig({dailyCreditLimit: value ?? 0})}
              />
            </label>
            <label>
              <span>{t('agentReadBudget')}</span>
              <InputNumber
                min={5000}
                step={5000}
                value={config.readBudget}
                onChange={(value) => saveConfig({readBudget: value ?? 40000})}
              />
            </label>
            <label>
              <span>{t('agentDeepBudget')}</span>
              <InputNumber
                min={20000}
                step={20000}
                value={config.deepBudget}
                onChange={(value) => saveConfig({deepBudget: value ?? 200000})}
              />
            </label>
          </div>
          <span className={styles.profileHint}>{t('agentBudgetHint')}</span>
          <div className={styles.agentConsent}>
            {consent.profiles?.[profileId] ? (
              <>
                <IconCheck size={14} /> {t('agentConsentGiven')}
                <Button
                  size="small"
                  type="link"
                  onClick={() => saveConsent({profiles: {...consent.profiles, [profileId]: false}})}
                >
                  {t('agentConsentRevoke')}
                </Button>
              </>
            ) : (
              <span className={styles.profileHint}>{t('agentConsentNotYet')}</span>
            )}
          </div>
        </div>
      </section>

      <section className={`${styles.card} ${styles.cardOpen}`}>
        <div className={styles.cardBody}>
          <div className={styles.profileApps}>
            <span className={styles.agentLabel}>
              {t('agentInstructionsStation')}
              {config.stationInstructions !== null && (
                <Button
                  size="small"
                  type="link"
                  icon={<IconRestore size={14} />}
                  onClick={() => saveConfig({stationInstructions: null})}
                >
                  {t('agentInstructionsReset')}
                </Button>
              )}
            </span>
            <SavedText
              value={config.stationInstructions ?? defaults?.stationInstructions ?? ''}
              rows={8}
              onSave={(text) => saveConfig({stationInstructions: text === defaults?.stationInstructions ? null : text})}
            />
            <span className={styles.agentLabel}>{t('agentInstructionsProject')}</span>
            <SavedText
              value={project.instructions}
              onSave={(instructions) => saveProject({instructions})}
              placeholder={t('agentInstructionsProjectHint')}
            />
            <span className={styles.agentLabel}>{t('agentInstructionsPersonal')}</span>
            <SavedText
              value={config.personalInstructions}
              onSave={(personalInstructions) => saveConfig({personalInstructions})}
              placeholder={t('agentInstructionsPersonalHint')}
            />
            <span className={styles.profileHint}>{t('agentInstructionsHint')}</span>
            {files.length > 0 && (
              <div className={styles.agentFiles}>
                <span>{t('agentAlsoReads')}</span>
                {files.map((file) => (
                  <span key={file.uri} className={styles.profileHint}>
                    <span className={styles.mono}>{file.name}</span> · {t('agentTokens', {count: file.tokens})}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <HandsSettings
        limit={config.handsLimit}
        onLimit={(handsLimit) => saveConfig({handsLimit})}
        extended={!!config.handsExtended}
        onExtended={(handsExtended) => saveConfig({handsExtended})}
      />

      <ExternalAgentsSettings />

      <section className={`${styles.card} ${styles.cardOpen}`}>
        <div className={styles.cardBody}>
          <span className={styles.agentLabel}>{t('memoryTitle')}</span>
          <MemorySettings />
        </div>
      </section>

      <section className={`${styles.card} ${styles.cardOpen}`}>
        <div className={styles.cardBody}>
          <div className={styles.profileApps}>
            <span className={styles.agentLabel}>{t('agentMcpProject')}</span>
            <ServerJson
              servers={(project.mcpServers ?? []).map(cleanServer)}
              statuses={agent.mcp}
              onChange={(mcpServers) => saveProject({mcpServers})}
            />
            <span className={styles.agentLabel}>{t('agentMcpStation')}</span>
            <ServerJson
              servers={(config.mcpServers ?? []).map(cleanServer)}
              statuses={agent.mcp}
              onChange={(mcpServers) => saveConfig({mcpServers})}
            />
            <span className={styles.profileHint}>{t('agentMcpHint')}</span>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AgentSettings;
