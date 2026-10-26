import {IconArrowForwardUp, IconClockPause, IconPlayerPause, IconPlugConnectedX, IconWand} from '@tabler/icons-react';
import {AutoComplete, Button, Checkbox, Input, InputNumber, Segmented} from 'antd';
import {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {prettyBody} from './exchange-utils.js';

import styles from './Proxy.module.css';

export const ACTION_ICONS = {
  respond: IconWand,
  breakpoint: IconPlayerPause,
  delay: IconClockPause,
  fail: IconPlugConnectedX,
  redirect: IconArrowForwardUp,
};

const STATUS_PRESETS = [200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503];
const DELAY_PRESETS = [1000, 3000, 10000, 30000];

/**
 * The ways one request can be widened into a rule, narrowest last: the same
 * path with any query, exactly this URL, or anything on the same host.
 */
export function scopesFor(exchange) {
  try {
    const url = new URL(exchange.url);
    return [
      {key: 'path', url: `${url.origin}${url.pathname}*`},
      {key: 'exact', url: exchange.url},
      {key: 'host', url: `${url.origin}/*`},
    ];
  } catch {
    return [{key: 'exact', url: exchange.url}];
  }
}

const shortPath = (pattern) => {
  try {
    const url = new URL(pattern.replace(/\*/g, ''));
    return `${url.pathname}${url.search}`.replace(/\/$/, '') || url.host;
  } catch {
    return pattern;
  }
};

/**
 * A name nobody has to type: what the rule does and to which requests.
 */
export const ruleName = (rule, t) =>
  `${t(`proxyActionShort_${rule.action}`)} · ${rule.method ? `${rule.method} ` : ''}${shortPath(rule.url)}`;

/**
 * A rule made from one request, ready to save as it is.
 */
export function ruleFromExchange(exchange, action, patch = {}) {
  const [scope] = scopesFor(exchange);
  const contentType = exchange.responseHeaders?.['content-type'];
  // only a mocked answer needs the response; other rules stay small
  const answer =
    action === 'respond'
      ? {
          status: String(exchange.status || 200),
          headers: contentType ? `content-type: ${contentType}` : '',
          body: exchange.responseBody ? prettyBody(exchange.responseBody) : '',
        }
      : {status: '200', headers: '', body: ''};
  return {
    id: Date.now().toString(36),
    name: '',
    enabled: true,
    method: exchange.method,
    url: scope.url,
    action,
    ...answer,
    target: '',
    delayMs: 3000,
    stage: 'response',
    ...patch,
  };
}

/**
 * Body shortcuts for a mocked response.
 */
const bodyPresets = (original) => [
  {key: 'original', body: original},
  {key: 'empty', body: ''},
  {key: 'emptyList', body: '[]'},
  {key: 'emptyObject', body: '{}'},
];

/**
 * One rewrite rule, edited by picking rather than typing: which requests it
 * catches comes from the request it was made from; the answer starts as the
 * real one.
 *
 * `exchange` is the request the rule was made from, if any. `knownUrls` feeds
 * the suggestions when there is none.
 */
const RuleEditor = ({rule, exchange, knownUrls = [], onSave, onCancel}) => {
  const {t} = useTranslation();
  const [draft, setDraft] = useState(rule);
  const scopes = useMemo(() => (exchange ? scopesFor(exchange) : []), [exchange]);
  const scope = scopes.find((s) => s.url === draft.url)?.key ?? 'custom';
  const [customUrl, setCustomUrl] = useState(scope === 'custom' && !!exchange);
  const [showHeaders, setShowHeaders] = useState(false);
  const originalBody = exchange?.responseBody ? prettyBody(exchange.responseBody) : rule.body;
  const set = (patch) => setDraft((current) => ({...current, ...patch}));
  const Icon = ACTION_ICONS[draft.action];

  const urlOptions = useMemo(() => {
    const needle = draft.url.toLowerCase();
    return knownUrls
      .filter((url) => !needle || url.toLowerCase().includes(needle))
      .slice(0, 12)
      .map((url) => ({value: url}));
  }, [knownUrls, draft.url]);

  const hostOptions = useMemo(
    () =>
      [...new Set(knownUrls.map((url) => url.match(/^[a-z]+:\/\/[^/]+/i)?.[0]).filter(Boolean))].map((value) => ({
        value,
      })),
    [knownUrls],
  );

  return (
    <div className={styles.ruleEditor}>
      <div className={styles.ruleEditorHead}>
        {Icon && <Icon size={18} stroke={1.7} className={styles.ruleEditorIcon} />}
        <span className={styles.ruleName}>{t(`proxyAction_${draft.action}`)}</span>
        {!exchange && (
          <Segmented
            size="small"
            value={draft.action}
            onChange={(action) => set({action})}
            options={Object.keys(ACTION_ICONS).map((action) => ({
              value: action,
              label: t(`proxyActionShort_${action}`),
            }))}
          />
        )}
      </div>

      <div className={styles.field}>
        <span>{t('proxyRuleCatches')}</span>
        {exchange && !customUrl ? (
          <Segmented
            block
            value={scope}
            onChange={(key) => set({url: scopes.find((s) => s.key === key).url})}
            options={scopes.map((s) => ({value: s.key, label: t(`proxyScope_${s.key}`)}))}
          />
        ) : (
          <AutoComplete
            value={draft.url}
            options={urlOptions}
            onChange={(url) => set({url})}
            className={styles.monoInput}
            placeholder={t('proxyRuleUrl')}
          />
        )}
        <div className={styles.ruleScopeLine}>
          <code className={styles.rulePattern}>{draft.url || '—'}</code>
          {exchange && (
            <button className={styles.linkButton} onClick={() => setCustomUrl(!customUrl)}>
              {customUrl ? t('proxyScopePick') : t('proxyScopeCustom')}
            </button>
          )}
        </div>
        <Checkbox
          checked={!!draft.method}
          onChange={(e) => set({method: e.target.checked ? exchange?.method || 'GET' : ''})}
        >
          {draft.method ? t('proxyOnlyMethod', {method: draft.method}) : t('proxyAnyMethodCheck')}
        </Checkbox>
      </div>

      {draft.action === 'respond' && (
        <>
          <div className={styles.field}>
            <span>{t('proxyStatus')}</span>
            <div className={styles.presetRow}>
              {STATUS_PRESETS.map((status) => (
                <button
                  key={status}
                  aria-pressed={draft.status === String(status)}
                  className={`${styles.preset} ${draft.status === String(status) ? styles.presetOn : ''} ${
                    status >= 400 ? styles.presetError : ''
                  }`}
                  onClick={() => set({status: String(status)})}
                >
                  {status}
                </button>
              ))}
              <InputNumber
                size="small"
                min={100}
                max={599}
                value={Number(draft.status) || null}
                onChange={(status) => set({status: String(status ?? '')})}
                className={styles.presetInput}
                aria-label={t('proxyStatus')}
              />
            </div>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldHead}>
              {t('proxyResponseBody')}
              <span className={styles.presetRow}>
                {bodyPresets(originalBody).map((preset) => (
                  <button
                    key={preset.key}
                    className={`${styles.preset} ${styles.presetSmall}`}
                    onClick={() => set({body: preset.body})}
                  >
                    {t(`proxyBody_${preset.key}`)}
                  </button>
                ))}
                <button
                  className={`${styles.preset} ${styles.presetSmall}`}
                  onClick={() => set({body: prettyBody(draft.body)})}
                >
                  {t('proxyBody_format')}
                </button>
              </span>
            </span>
            <Input.TextArea
              value={draft.body}
              onChange={(e) => set({body: e.target.value})}
              autoSize={{minRows: 6, maxRows: 18}}
              className={styles.monoInput}
              spellCheck={false}
            />
          </div>
          <div className={styles.field}>
            <button className={styles.linkButton} onClick={() => setShowHeaders(!showHeaders)}>
              {t('proxyHeadersToggle', {count: draft.headers.split('\n').filter((l) => l.includes(':')).length})}
            </button>
            {showHeaders && (
              <Input.TextArea
                value={draft.headers}
                onChange={(e) => set({headers: e.target.value})}
                autoSize={{minRows: 2, maxRows: 8}}
                className={styles.monoInput}
                placeholder="content-type: application/json"
              />
            )}
          </div>
        </>
      )}

      {draft.action === 'breakpoint' && (
        <div className={styles.field}>
          <span>{t('proxyStopOn')}</span>
          <Segmented
            block
            value={draft.stage}
            onChange={(stage) => set({stage})}
            options={['request', 'response', 'both'].map((s) => ({value: s, label: t(`proxyStage_${s}`)}))}
          />
        </div>
      )}

      {draft.action === 'delay' && (
        <div className={styles.field}>
          <span>{t('proxyRuleDelay')}</span>
          <div className={styles.presetRow}>
            {DELAY_PRESETS.map((ms) => (
              <button
                key={ms}
                aria-pressed={draft.delayMs === ms}
                className={`${styles.preset} ${draft.delayMs === ms ? styles.presetOn : ''}`}
                onClick={() => set({delayMs: ms})}
              >
                {t('proxySeconds', {count: ms / 1000})}
              </button>
            ))}
            <InputNumber
              size="small"
              min={0}
              max={120000}
              step={500}
              value={draft.delayMs}
              onChange={(delayMs) => set({delayMs: delayMs ?? 0})}
              className={styles.presetInput}
              aria-label={t('proxyRuleDelay')}
              addonAfter="ms"
            />
          </div>
        </div>
      )}

      {draft.action === 'redirect' && (
        <div className={styles.field}>
          <span>{t('proxyRuleTarget')}</span>
          <AutoComplete
            value={draft.target}
            options={hostOptions}
            onChange={(target) => set({target})}
            className={styles.monoInput}
            placeholder="https://staging.api.company.com"
          />
        </div>
      )}

      {draft.action === 'fail' && <p className={styles.ruleHint}>{t('proxyFailHint')}</p>}

      <div className={styles.actions}>
        <Button
          type="primary"
          disabled={!draft.url.trim() || (draft.action === 'redirect' && !draft.target.trim())}
          onClick={() => onSave({...draft, name: ruleName(draft, t)})}
        >
          {t('proxyRuleSave')}
        </Button>
        <Button type="text" onClick={onCancel}>
          {t('Cancel')}
        </Button>
      </div>
    </div>
  );
};

export default RuleEditor;
