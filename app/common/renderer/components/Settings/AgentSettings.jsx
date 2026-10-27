import {IconBrain, IconCheck, IconPlugConnected, IconPlus, IconRestore, IconTrash} from '@tabler/icons-react';
import {App, Button, Checkbox, Input, InputNumber, Select, Switch, Tag} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {formatCredits} from '../../../shared/agent/credits.js';
import {cleanServer} from '../../../shared/agent/mcp-servers.js';
import {AGENT_CONFIG, AGENT_CONSENT, AGENT_PROJECT, DEFAULT_SETTINGS} from '../../../shared/setting-defs.js';
import {refreshCredits, useAgent} from '../../lib/agent/agent-store.js';
import {useProfiles} from '../../lib/settings/profiles-store.js';
import {backend, getSetting, setSetting} from '../../polyfills.js';

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

/** A name and a value, the value hidden in the keychain when it is a token or a key. */
const PairList = ({pairs, onChange, secrets, onSecret, namePlaceholder}) => {
  const {t} = useTranslation();
  return (
    <div className={styles.agentPairs}>
      {pairs.map((pair, index) => (
        <div key={pair.id} className={styles.agentPair}>
          <Input
            value={pair.name}
            placeholder={namePlaceholder}
            onChange={(e) => onChange(pairs.map((one, at) => (at === index ? {...one, name: e.target.value} : one)))}
            className={styles.mono}
          />
          {pair.hidden ? (
            <Input.Password
              placeholder={secrets.includes(pair.name) ? t('agentMcpSecretSaved') : t('agentMcpSecretValue')}
              onBlur={(e) => e.target.value && onSecret(pair.name, e.target.value)}
              className={styles.mono}
            />
          ) : (
            <Input
              value={pair.value}
              onChange={(e) => onChange(pairs.map((one, at) => (at === index ? {...one, value: e.target.value} : one)))}
              className={styles.mono}
            />
          )}
          <Checkbox
            checked={pair.hidden}
            onChange={(e) =>
              onChange(pairs.map((one, at) => (at === index ? {...one, hidden: e.target.checked, value: ''} : one)))
            }
          >
            {t('agentMcpHidden')}
          </Checkbox>
          <Button
            type="text"
            icon={<IconTrash size={14} />}
            onClick={() => onChange(pairs.filter((_, at) => at !== index))}
          />
        </div>
      ))}
      <Button
        size="small"
        type="link"
        icon={<IconPlus size={14} />}
        onClick={() =>
          onChange([...pairs, {id: Math.random().toString(36).slice(2, 9), name: '', value: '', hidden: false}])
        }
      >
        {t('agentMcpAddPair')}
      </Button>
    </div>
  );
};

const ServerCard = ({server, onChange, onRemove, status}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const [secrets, setSecrets] = useState([]);
  const [check, setCheck] = useState(null);
  useEffect(() => {
    backend.agent.mcpSecretNames(server.id).then(setSecrets);
  }, [server.id]);
  const saveSecret = async (name, value) => {
    setSecrets(await backend.agent.setMcpSecrets(server.id, {[name]: value}));
    message.success(t('agentMcpSecretKept'));
  };
  const runCheck = async () => {
    setCheck({running: true});
    setCheck(await backend.agent.testMcp(server));
  };
  const state = status ? (status.failedAuthorization ? 'login' : status.status) : null;
  return (
    <div className={styles.sourceRepo}>
      <div className={styles.sourceRepoHead}>
        <Input
          value={server.name}
          onChange={(e) => onChange({...server, name: e.target.value})}
          className={styles.sourceName}
          aria-label={t('agentMcpName')}
        />
        <Select
          value={server.kind}
          onChange={(kind) => onChange({...server, kind})}
          options={[
            {value: 'http', label: t('agentMcpKind_http')},
            {value: 'stdio', label: t('agentMcpKind_stdio')},
          ]}
          className={styles.sourceRole}
        />
        <Switch checked={server.enabled} onChange={(enabled) => onChange({...server, enabled})} size="small" />
        {state && <Tag>{t(`agentMcpState_${state}`, {defaultValue: state})}</Tag>}
        <Button
          type="text"
          danger
          icon={<IconTrash size={16} />}
          onClick={onRemove}
          aria-label={t('settingsSourceRemove')}
        />
      </div>
      {server.kind === 'http' ? (
        <>
          <Input
            value={server.url}
            placeholder="https://mcp.example.com/mcp"
            onChange={(e) => onChange({...server, url: e.target.value})}
            className={styles.mono}
          />
          <PairList
            pairs={server.headers}
            onChange={(headers) => onChange({...server, headers})}
            secrets={secrets}
            onSecret={saveSecret}
            namePlaceholder="Authorization"
          />
          <Checkbox checked={server.oauth} onChange={(e) => onChange({...server, oauth: e.target.checked})}>
            {t('agentMcpOauth')}
          </Checkbox>
        </>
      ) : (
        <>
          <Input
            value={[server.command, ...server.args].join(' ')}
            placeholder="npx -y @acme/mcp-server"
            onChange={(e) => {
              const [command = '', ...args] = e.target.value.split(' ');
              onChange({...server, command, args});
            }}
            className={styles.mono}
          />
          <PairList
            pairs={server.env}
            onChange={(env) => onChange({...server, env})}
            secrets={secrets}
            onSecret={saveSecret}
            namePlaceholder="API_TOKEN"
          />
        </>
      )}
      <div className={styles.sourceActions}>
        <Button size="small" icon={<IconPlugConnected size={14} />} loading={check?.running} onClick={runCheck}>
          {t('agentMcpCheck')}
        </Button>
        {check?.ok && <span className={styles.profileHint}>{t('agentMcpTools', {count: check.tools.length})}</span>}
        {check && check.ok === false && (
          <span className={styles.sourceError}>
            <span className={styles.sourceWarn}>
              {t(`agentMcpError_${check.error}`, {defaultValue: t('agentMcpError_other')})}
            </span>
            {check.detail && <code className={styles.sourceDetail}>{check.detail}</code>}
          </span>
        )}
      </div>
    </div>
  );
};

const ServerList = ({servers, onChange, statuses}) => {
  const {t} = useTranslation();
  return (
    <div className={styles.profileApps}>
      {servers.map((server, index) => (
        <ServerCard
          key={server.id}
          server={server}
          status={statuses.find((one) => one.name === server.name)}
          onChange={(next) => onChange(servers.map((one, at) => (at === index ? cleanServer(next) : one)))}
          onRemove={() => onChange(servers.filter((_, at) => at !== index))}
        />
      ))}
      <div>
        <Button
          size="small"
          icon={<IconPlus size={14} />}
          onClick={() => onChange([...servers, cleanServer({name: 'server', kind: 'http'})])}
        >
          {t('agentMcpAdd')}
        </Button>
      </div>
    </div>
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

      <section className={`${styles.card} ${styles.cardOpen}`}>
        <div className={styles.cardBody}>
          <div className={styles.profileApps}>
            <span className={styles.agentLabel}>{t('agentMcpProject')}</span>
            <ServerList
              servers={(project.mcpServers ?? []).map(cleanServer)}
              statuses={agent.mcp}
              onChange={(mcpServers) => saveProject({mcpServers})}
            />
            <span className={styles.agentLabel}>{t('agentMcpStation')}</span>
            <ServerList
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
