import {
  IconBan,
  IconChevronDown,
  IconCopy,
  IconDots,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconRepeat,
  IconTrash,
  IconWand,
  IconX,
} from '@tabler/icons-react';
import {Alert, App, Button, Dropdown, Input, Modal, Segmented, Select, Switch, Tooltip} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';

import {parseHeaderLines, ruleMatches} from '../../../shared/proxy/mock-rules.js';
import {backend} from '../../polyfills.js';
import {formatDuration, formatSize, headerLines, prettyBody, statusTone, toCurl} from './exchange-utils.js';
import {proxyState, resumePause, saveProxyConfig, useProxy} from './proxy-store.js';
import RuleEditor, {ACTION_ICONS, ruleFromExchange, ruleName} from './RuleEditor.jsx';

import styles from './Proxy.module.css';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/**
 * A stopped request or response, editable before it goes on.
 */
const PauseEditor = ({pause}) => {
  const {t} = useTranslation();
  const isRequest = pause.kind === 'request';
  const [draft, setDraft] = useState(() => ({
    method: pause.data.method,
    url: pause.data.url,
    status: String(pause.data.status ?? ''),
    headers: headerLines(pause.data.headers),
    body: prettyBody(pause.data.body),
  }));
  const set = (key) => (e) => setDraft({...draft, [key]: e.target.value});

  const release = (edited) =>
    resumePause(
      pause.id,
      edited
        ? {
            action: 'edit',
            method: draft.method,
            url: draft.url,
            status: Number(draft.status),
            headers: parseHeaderLines(draft.headers),
            body: draft.body,
          }
        : {action: 'release'},
    );

  return (
    <div className={styles.pause}>
      <div className={styles.pauseHead}>
        <IconPlayerPause size={18} />
        <div className={styles.stack}>
          <span className={styles.pauseTitle}>{t(isRequest ? 'proxyPausedRequest' : 'proxyPausedResponse')}</span>
          <span className={styles.sub}>{t('proxyPausedHint')}</span>
        </div>
      </div>
      {isRequest ? (
        <div className={styles.fieldRow}>
          <label className={styles.field} style={{flex: '0 0 120px'}}>
            <span>{t('proxyMethod')}</span>
            <Select
              value={draft.method}
              onChange={(method) => setDraft({...draft, method})}
              options={METHODS.map((m) => ({value: m, label: m}))}
            />
          </label>
          <label className={styles.field} style={{flex: 1}}>
            <span>URL</span>
            <Input value={draft.url} onChange={set('url')} className={styles.monoInput} />
          </label>
        </div>
      ) : (
        <div className={styles.field}>
          <span>{t('proxyStatus')}</span>
          <div className={styles.presetRow}>
            {[200, 400, 401, 403, 404, 500, 503].map((status) => (
              <button
                key={status}
                aria-pressed={draft.status === String(status)}
                className={`${styles.preset} ${draft.status === String(status) ? styles.presetOn : ''} ${
                  status >= 400 ? styles.presetError : ''
                }`}
                onClick={() => setDraft({...draft, status: String(status)})}
              >
                {status}
              </button>
            ))}
            <Input
              size="small"
              value={draft.status}
              onChange={set('status')}
              className={`${styles.monoInput} ${styles.presetInput}`}
              aria-label={t('proxyStatus')}
            />
          </div>
        </div>
      )}
      <label className={styles.field}>
        <span>{t('proxyHeaders')}</span>
        <Input.TextArea
          value={draft.headers}
          onChange={set('headers')}
          autoSize={{minRows: 2, maxRows: 6}}
          className={styles.monoInput}
        />
      </label>
      <label className={styles.field}>
        <span>{t(isRequest ? 'proxyRequestBody' : 'proxyResponseBody')}</span>
        <Input.TextArea
          value={draft.body}
          onChange={set('body')}
          autoSize={{minRows: 4, maxRows: 14}}
          className={styles.monoInput}
          spellCheck={false}
        />
      </label>
      <div className={styles.actions}>
        <Button type="primary" icon={<IconPlayerPlay size={16} />} onClick={() => release(true)}>
          {t('proxyReleaseEdited')}
        </Button>
        <Button onClick={() => release(false)}>{t('proxyReleaseAsIs')}</Button>
        <Button danger icon={<IconBan size={16} />} onClick={() => resumePause(pause.id, {action: 'abort'})}>
          {t('proxyAbort')}
        </Button>
      </div>
    </div>
  );
};

/**
 * Sends a request again from the workstation, with changes.
 */
const ReplayModal = ({exchange, onClose}) => {
  const {t} = useTranslation();
  const [draft, setDraft] = useState(() => ({
    method: exchange.method,
    url: exchange.url,
    headers: headerLines(exchange.requestHeaders),
    body: exchange.requestBody ?? '',
  }));
  const [sending, setSending] = useState(false);
  const send = async () => {
    setSending(true);
    try {
      await backend.proxy.replay({...draft, headers: parseHeaderLines(draft.headers)});
      onClose(true);
    } finally {
      setSending(false);
    }
  };
  return (
    <Modal
      open
      title={t('proxyReplayTitle')}
      onCancel={() => onClose(false)}
      onOk={send}
      okText={t('proxyReplaySend')}
      confirmLoading={sending}
      width={720}
      destroyOnHidden
    >
      <div className={styles.replay}>
        <div className={styles.fieldRow}>
          <Select
            value={draft.method}
            onChange={(method) => setDraft({...draft, method})}
            options={METHODS.map((m) => ({value: m, label: m}))}
            style={{width: 120}}
          />
          <Input
            value={draft.url}
            onChange={(e) => setDraft({...draft, url: e.target.value})}
            className={styles.monoInput}
          />
        </div>
        <label className={styles.field}>
          <span>{t('proxyHeaders')}</span>
          <Input.TextArea
            value={draft.headers}
            onChange={(e) => setDraft({...draft, headers: e.target.value})}
            autoSize={{minRows: 3, maxRows: 8}}
            className={styles.monoInput}
          />
        </label>
        <label className={styles.field}>
          <span>{t('proxyRequestBody')}</span>
          <Input.TextArea
            value={draft.body}
            onChange={(e) => setDraft({...draft, body: e.target.value})}
            autoSize={{minRows: 3, maxRows: 12}}
            className={styles.monoInput}
          />
        </label>
        <span className={styles.sub}>{t('proxyReplayNote')}</span>
      </div>
    </Modal>
  );
};

const Body = ({text, binary, size, truncated}) => {
  const {t} = useTranslation();
  if (binary) {
    return <div className={styles.quiet}>{t('proxyBinaryBody', {size: formatSize(size)})}</div>;
  }
  if (!text) {
    return <div className={styles.quiet}>{t('proxyEmptyBody')}</div>;
  }
  return (
    <>
      {truncated && <div className={styles.quiet}>{t('proxyTruncated')}</div>}
      <pre className={styles.code}>{prettyBody(text)}</pre>
    </>
  );
};

const {delay: DelayIcon, fail: FailIcon, redirect: RedirectIcon} = ACTION_ICONS;

/**
 * One request and its response: what was sent, what came back, what the
 * rules say, and what to do with it.
 */
const ExchangeDetail = ({exchange, pause, mockRuleNames, onClose}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const [tab, setTab] = useState('response');
  const [replaying, setReplaying] = useState(false);
  const [editing, setEditing] = useState(null);
  const {config} = useProxy();
  const tone = statusTone(exchange);

  const rules = config.mockRules;
  const applying = rules.filter((rule) => ruleMatches({...rule, enabled: true}, exchange.method, exchange.url));
  const saveRules = (mockRules, patch = {}) => saveProxyConfig({mockRules, ...patch});

  // a rule only works while its mode is on: adding one turns the mode on
  const modeFor = (rule) => (rule.action === 'breakpoint' ? {breakpointsEnabled: true} : {mocksEnabled: true});

  const addRule = async (rule) => {
    const named = {...rule, name: ruleName(rule, t)};
    await saveRules([...rules, named], modeFor(named));
    setEditing(null);
    message.open({
      type: 'success',
      content: (
        <span>
          {t('proxyRuleAdded', {name: named.name})}{' '}
          <button
            className={styles.linkButton}
            onClick={() => saveRules(proxyState().config.mockRules.filter((r) => r.id !== named.id))}
          >
            {t('proxyUndo')}
          </button>
        </span>
      ),
    });
  };

  const saveEdited = async (rule) => {
    const exists = rules.some((r) => r.id === rule.id);
    if (!exists) {
      await addRule(rule);
      return;
    }
    await saveRules(
      rules.map((r) => (r.id === rule.id ? rule : r)),
      modeFor(rule),
    );
    setEditing(null);
  };

  const stopMenu = {
    items: ['response', 'request', 'both'].map((stage) => ({key: stage, label: t(`proxyStopOn_${stage}`)})),
    onClick: ({key}) => addRule(ruleFromExchange(exchange, 'breakpoint', {stage: key})),
  };
  const moreMenu = {
    items: [
      {key: 'delay', label: t('proxyQuickDelay'), icon: <DelayIcon size={14} />},
      {key: 'fail', label: t('proxyQuickFail'), icon: <FailIcon size={14} />},
      {key: 'redirect', label: t('proxyQuickRedirect'), icon: <RedirectIcon size={14} />},
      {type: 'divider'},
      {key: 'replay', label: t('proxyReplay'), icon: <IconRepeat size={14} />},
    ],
    onClick: ({key}) => {
      if (key === 'replay') {
        setReplaying(true);
      } else if (key === 'redirect') {
        setEditing(ruleFromExchange(exchange, 'redirect'));
      } else {
        addRule(ruleFromExchange(exchange, key));
      }
    },
  };
  const flags = exchange.flags ?? [];

  const reasons = [
    flags.includes('error') && {flag: 'error', text: t('proxyWhy_error', {status: exchange.status})},
    flags.includes('slow') && {
      flag: 'slow',
      text: exchange.slowLimit?.rule
        ? t('proxyWhy_slowRule', {
            duration: formatDuration(exchange.durationMs),
            limit: formatDuration(exchange.slowLimit.ms),
            rule: exchange.slowLimit.rule,
          })
        : exchange.slowLimit
          ? t('proxyWhy_slowDefault', {
              duration: formatDuration(exchange.durationMs),
              limit: formatDuration(exchange.slowLimit.ms),
            })
          : t('proxyWhy_slow', {duration: formatDuration(exchange.durationMs)}),
    },
    // the first of the repeats has nothing before it: it was repeated later
    flags.includes('dupe') && {
      flag: 'dupe',
      text: exchange.duplicateOf?.length
        ? t('proxyWhy_dupe', {count: exchange.duplicateOf.length + 1})
        : t('proxyWhy_dupeFirst'),
    },
    flags.includes('contract') && {
      flag: 'contract',
      text: t('proxyWhy_contract', {missing: (exchange.missing ?? []).join(', ')}),
    },
    flags.includes('mock') && {
      flag: 'mock',
      text: t('proxyWhy_mock', {rules: exchange.mockRules.map((id) => mockRuleNames[id] ?? id).join(', ')}),
    },
    flags.includes('held') && {flag: 'held', text: t('proxyWhy_held')},
    flags.includes('ignored') && {flag: 'ignored', text: t('proxyWhy_ignored')},
    flags.includes('replay') && {flag: 'replay', text: t('proxyWhy_replay')},
    exchange.error && {flag: 'error', text: exchange.error},
  ].filter(Boolean);

  const timings = exchange.timings && exchange.durationMs ? exchange.timings : null;

  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <span className={`${styles.method} ${styles[`method_${exchange.method}`] ?? ''}`}>{exchange.method}</span>
        <span className={`${styles.statusPill} ${styles[`tone_${tone}`]}`}>
          {tone === 'paused'
            ? t('proxyPaused')
            : exchange.status === null
              ? t('proxyWaiting')
              : exchange.status || 'ERR'}
        </span>
        <div className={styles.spacer} />
        <Tooltip title={t('proxyClose')}>
          <Button type="text" size="small" aria-label={t('proxyClose')} icon={<IconX size={16} />} onClick={onClose} />
        </Tooltip>
      </div>
      <div className={styles.url}>{exchange.url}</div>
      <div className={styles.sub}>
        {[
          new Date(exchange.startedAt).toLocaleTimeString(),
          formatDuration(exchange.durationMs),
          exchange.responseSize ? formatSize(exchange.responseSize) : '',
          exchange.httpVersion ? `HTTP/${exchange.httpVersion}` : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>

      <div className={styles.actions}>
        <Button
          size="small"
          type="primary"
          icon={<IconWand size={14} />}
          onClick={() => setEditing(ruleFromExchange(exchange, 'respond'))}
        >
          {t('proxyMockResponse')}
        </Button>
        <Dropdown menu={stopMenu} trigger={['click']}>
          <Button size="small" icon={<IconPlayerPause size={14} />}>
            {t('proxyStopThese')} <IconChevronDown size={12} />
          </Button>
        </Dropdown>
        <Button
          size="small"
          icon={<IconCopy size={14} />}
          onClick={() => navigator.clipboard.writeText(toCurl(exchange)).then(() => message.success(t('proxyCopied')))}
        >
          cURL
        </Button>
        <Dropdown menu={moreMenu} trigger={['click']}>
          <Button size="small" aria-label={t('proxyMore')} icon={<IconDots size={14} />} />
        </Dropdown>
      </div>

      {editing && (
        <RuleEditor
          key={editing.id}
          rule={editing}
          exchange={exchange}
          onSave={saveEdited}
          onCancel={() => setEditing(null)}
        />
      )}

      {applying.length > 0 && !editing && (
        <div className={styles.applying}>
          <span className={styles.label}>{t('proxyRulesHere')}</span>
          {applying.map((rule) => {
            const Icon = ACTION_ICONS[rule.action];
            return (
              <div key={rule.id} className={styles.ruleRow}>
                <Switch
                  size="small"
                  checked={rule.enabled !== false}
                  aria-label={rule.name}
                  onChange={(enabled) => saveRules(rules.map((r) => (r.id === rule.id ? {...r, enabled} : r)))}
                />
                {Icon && <Icon size={15} className={styles.ruleIcon} />}
                <span className={styles.ruleText}>
                  <span className={styles.ruleName}>{rule.name}</span>
                </span>
                <Tooltip title={t('proxyRuleEdit')}>
                  <Button
                    size="small"
                    type="text"
                    aria-label={t('proxyRuleEdit')}
                    icon={<IconPencil size={14} />}
                    onClick={() => setEditing(rule)}
                  />
                </Tooltip>
                <Tooltip title={t('logsRuleDelete')}>
                  <Button
                    size="small"
                    type="text"
                    aria-label={t('logsRuleDelete')}
                    icon={<IconTrash size={14} />}
                    onClick={() => saveRules(rules.filter((r) => r.id !== rule.id))}
                  />
                </Tooltip>
              </div>
            );
          })}
        </div>
      )}

      {pause && <PauseEditor key={pause.id} pause={pause} />}

      {reasons.length > 0 && (
        <div className={styles.reasons}>
          {reasons.map((reason) => (
            <div
              key={`${reason.flag}:${reason.text}`}
              className={`${styles.reason} ${styles[`reason_${reason.flag}`] ?? ''}`}
            >
              {reason.text}
            </div>
          ))}
        </div>
      )}

      {timings && (
        <div className={styles.timings}>
          <div className={styles.timingBar}>
            {['request', 'wait', 'download'].map((phase) =>
              timings[phase] ? (
                <span
                  key={phase}
                  className={styles[`phase_${phase}`]}
                  style={{flex: Math.max(timings[phase], 1)}}
                  title={`${t(`proxyPhase_${phase}`)} ${timings[phase]} ms`}
                />
              ) : null,
            )}
          </div>
          <div className={styles.timingLegend}>
            {['request', 'wait', 'download'].map((phase) =>
              timings[phase] !== null ? (
                <span key={phase}>
                  <i className={styles[`phase_${phase}`]} />
                  {t(`proxyPhase_${phase}`)} {formatDuration(timings[phase])}
                </span>
              ) : null,
            )}
          </div>
        </div>
      )}

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          {value: 'response', label: t('proxyTabResponse')},
          {value: 'request', label: t('proxyTabRequest')},
          {value: 'headers', label: t('proxyHeaders')},
        ]}
      />
      {tab === 'response' && (
        <Body
          text={exchange.responseBody}
          binary={exchange.responseBinary}
          size={exchange.responseSize}
          truncated={exchange.responseTruncated}
        />
      )}
      {tab === 'request' && (
        <Body text={exchange.requestBody} binary={exchange.requestBinary} size={exchange.requestSize} />
      )}
      {tab === 'headers' && (
        <>
          <div className={styles.label}>{t('proxyTabRequest')}</div>
          <pre className={styles.code}>{headerLines(exchange.requestHeaders) || '—'}</pre>
          <div className={styles.label}>{t('proxyTabResponse')}</div>
          <pre className={styles.code}>{headerLines(exchange.responseHeaders) || '—'}</pre>
        </>
      )}

      {exchange.status === 0 && <Alert type="error" showIcon title={exchange.error} />}
      {replaying && (
        <ReplayModal
          exchange={exchange}
          onClose={(sent) => {
            setReplaying(false);
            if (sent) {
              message.success(t('proxyReplayed'));
            }
          }}
        />
      )}
    </div>
  );
};

export default ExchangeDetail;
