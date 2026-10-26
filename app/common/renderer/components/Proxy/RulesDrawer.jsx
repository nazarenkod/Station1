import {IconPlus, IconTrash} from '@tabler/icons-react';
import {App, Button, Drawer, Input, InputNumber, Switch, Tabs} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';

import {mergeTrafficRules} from '../../../shared/findings/traffic-rules.js';
import {saveProxyConfig} from './proxy-store.js';
import RuleEditor, {ACTION_ICONS, ruleName} from './RuleEditor.jsx';

import styles from './Proxy.module.css';

const lines = (list) => (list ?? []).join('\n');
const toList = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const EMPTY_RULE = {
  name: '',
  enabled: true,
  method: '',
  url: '',
  action: 'respond',
  status: '200',
  headers: 'content-type: application/json',
  body: '',
  target: '',
  delayMs: 3000,
  stage: 'response',
};

/**
 * The rewrite rules and breakpoints: on or off at a glance, edited in place.
 */
const MockRules = ({config, knownUrls}) => {
  const {t} = useTranslation();
  const [editing, setEditing] = useState(null);

  const save = async (rules, patch = {}) => saveProxyConfig({mockRules: rules, ...patch});
  const upsert = async (rule) => {
    const exists = config.mockRules.some((r) => r.id === rule.id);
    await save(
      exists ? config.mockRules.map((r) => (r.id === rule.id ? rule : r)) : [...config.mockRules, rule],
      rule.action === 'breakpoint' ? {breakpointsEnabled: true} : {mocksEnabled: true},
    );
    setEditing(null);
  };

  return (
    <div className={styles.rulesList}>
      <div className={styles.modeRow}>
        <span>{t('proxyMocksEnabled')}</span>
        <Switch checked={config.mocksEnabled} onChange={(mocksEnabled) => saveProxyConfig({mocksEnabled})} />
      </div>
      <div className={styles.modeRow}>
        <span>{t('proxyBreakpointsEnabled')}</span>
        <Switch
          checked={config.breakpointsEnabled}
          onChange={(breakpointsEnabled) => saveProxyConfig({breakpointsEnabled})}
        />
      </div>
      {!config.mockRules.length && !editing && <p className={styles.ruleHint}>{t('proxyRulesEmpty')}</p>}
      {config.mockRules.map((rule) => {
        if (editing?.id === rule.id) {
          return (
            <RuleEditor
              key={rule.id}
              rule={editing}
              knownUrls={knownUrls}
              onSave={upsert}
              onCancel={() => setEditing(null)}
            />
          );
        }
        const Icon = ACTION_ICONS[rule.action];
        return (
          <div key={rule.id} className={styles.ruleRow}>
            <Switch
              size="small"
              checked={rule.enabled !== false}
              aria-label={rule.name}
              onChange={(enabled) => upsert({...rule, enabled})}
            />
            {Icon && <Icon size={15} className={styles.ruleIcon} />}
            <button className={styles.ruleText} onClick={() => setEditing(rule)}>
              <span className={styles.ruleName}>{rule.name || ruleName(rule, t)}</span>
              <span className={styles.ruleMeta}>{rule.url}</span>
            </button>
            <Button
              size="small"
              type="text"
              aria-label={t('logsRuleDelete')}
              icon={<IconTrash size={14} />}
              onClick={() => save(config.mockRules.filter((r) => r.id !== rule.id))}
            />
          </div>
        );
      })}
      {editing && !config.mockRules.some((r) => r.id === editing.id) ? (
        <RuleEditor rule={editing} knownUrls={knownUrls} onSave={upsert} onCancel={() => setEditing(null)} />
      ) : (
        <Button
          icon={<IconPlus size={14} />}
          onClick={() => setEditing({...EMPTY_RULE, id: Date.now().toString(36)})}
          className={styles.addRule}
        >
          {t('proxyAddRule')}
        </Button>
      )}
      <p className={styles.ruleHint}>{t('proxyRulesTip')}</p>
    </div>
  );
};

/**
 * The numbers and lists of the traffic rules.
 */
const TrafficRules = ({config}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const merged = mergeTrafficRules(config.trafficRules);
  const [draft, setDraft] = useState(() => ({
    dupEnabled: merged.duplicates.enabled,
    windowMs: merged.duplicates.windowMs,
    minRepeats: merged.duplicates.minRepeats,
    dupIgnore: lines(merged.duplicates.ignore),
    slowEnabled: merged.slow.enabled,
    defaultMs: merged.slow.defaultMs,
    overrides: lines(merged.slow.overrides),
    errEnabled: merged.errors.enabled,
    except: lines(merged.errors.except),
    hosts: lines(merged.ignore.hosts),
    paths: lines(merged.ignore.paths),
  }));
  const set = (key) => (value) => setDraft({...draft, [key]: value?.target ? value.target.value : value});

  const save = async () => {
    await saveProxyConfig({
      trafficRules: {
        duplicates: {
          enabled: draft.dupEnabled,
          windowMs: draft.windowMs,
          minRepeats: draft.minRepeats,
          ignore: toList(draft.dupIgnore),
        },
        slow: {enabled: draft.slowEnabled, defaultMs: draft.defaultMs, overrides: toList(draft.overrides)},
        errors: {enabled: draft.errEnabled, except: toList(draft.except)},
        ignore: {hosts: toList(draft.hosts), paths: toList(draft.paths)},
      },
    });
    message.success(t('proxyRulesSaved'));
  };

  return (
    <div className={styles.rulesList}>
      <section className={styles.ruleBlock}>
        <div className={styles.modeRow}>
          <span className={styles.ruleName}>{t('proxyRuleDuplicates')}</span>
          <Switch checked={draft.dupEnabled} onChange={set('dupEnabled')} />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>{t('proxyWindowMs')}</span>
            <InputNumber value={draft.windowMs} onChange={set('windowMs')} min={100} step={100} />
          </label>
          <label className={styles.field}>
            <span>{t('proxyMinRepeats')}</span>
            <InputNumber value={draft.minRepeats} onChange={set('minRepeats')} min={2} max={20} />
          </label>
        </div>
        <label className={styles.field}>
          <span>{t('proxyDupIgnore')}</span>
          <Input.TextArea
            value={draft.dupIgnore}
            onChange={set('dupIgnore')}
            autoSize={{minRows: 2}}
            className={styles.monoInput}
            placeholder="*/ping"
          />
        </label>
      </section>
      <section className={styles.ruleBlock}>
        <div className={styles.modeRow}>
          <span className={styles.ruleName}>{t('proxyRuleSlow')}</span>
          <Switch checked={draft.slowEnabled} onChange={set('slowEnabled')} />
        </div>
        <label className={styles.field}>
          <span>{t('proxyDefaultMs')}</span>
          <InputNumber value={draft.defaultMs} onChange={set('defaultMs')} min={50} step={100} />
        </label>
        <label className={styles.field}>
          <span>{t('proxySlowOverrides')}</span>
          <Input.TextArea
            value={draft.overrides}
            onChange={set('overrides')}
            autoSize={{minRows: 2}}
            className={styles.monoInput}
            placeholder={'*/history* 2500\nPOST */transfers/confirm 3000'}
          />
        </label>
      </section>
      <section className={styles.ruleBlock}>
        <div className={styles.modeRow}>
          <span className={styles.ruleName}>{t('proxyRuleErrors')}</span>
          <Switch checked={draft.errEnabled} onChange={set('errEnabled')} />
        </div>
        <label className={styles.field}>
          <span>{t('proxyErrorExcept')}</span>
          <Input.TextArea
            value={draft.except}
            onChange={set('except')}
            autoSize={{minRows: 2}}
            className={styles.monoInput}
            placeholder="GET */templates/* 404"
          />
        </label>
      </section>
      <section className={styles.ruleBlock}>
        <span className={styles.ruleName}>{t('proxyRuleIgnore')}</span>
        <label className={styles.field}>
          <span>{t('proxyIgnoreHosts')}</span>
          <Input.TextArea
            value={draft.hosts}
            onChange={set('hosts')}
            autoSize={{minRows: 2}}
            className={styles.monoInput}
            placeholder={'*firebaselogging*\nevents.company.io'}
          />
        </label>
        <label className={styles.field}>
          <span>{t('proxyIgnorePaths')}</span>
          <Input.TextArea
            value={draft.paths}
            onChange={set('paths')}
            autoSize={{minRows: 2}}
            className={styles.monoInput}
            placeholder="/api/ping"
          />
        </label>
      </section>
      <Button type="primary" onClick={save}>
        {t('jiraSave')}
      </Button>
    </div>
  );
};

const RulesDrawer = ({open, onClose, config, knownUrls}) => {
  const {t} = useTranslation();
  const [tab, setTab] = useState('mocks');
  return (
    <Drawer open={open} onClose={onClose} title={t('proxyRules')} size={520} destroyOnHidden>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'mocks',
            label: t('proxyRulesMocks'),
            children: <MockRules config={config} knownUrls={knownUrls} />,
          },
          {key: 'traffic', label: t('proxyRulesTraffic'), children: <TrafficRules config={config} />},
        ]}
      />
    </Drawer>
  );
};

export default RulesDrawer;
