import {IconBook2, IconKey, IconLogin, IconPlus, IconTarget, IconTrash} from '@tabler/icons-react';
import {App, Button, Input, Modal, Segmented, Select, Tag} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';

import {
  cleanPlaybook,
  FORBIDDEN_KINDS,
  newAccount,
  newForbidden,
  PERMISSION_GROUPS,
  PERMISSION_VALUES,
} from '../../../shared/agent/playbook.js';
import {APP_PLAYBOOK} from '../../../shared/setting-defs.js';
import {useProfiles} from '../../lib/settings/profiles-store.js';
import {backend, getSetting, setSetting} from '../../polyfills.js';

import styles from './SettingsPage.module.css';

// a step repeated (a restart twice) keeps a key of its own
const stepKeys = (steps) =>
  steps.map((step, index) => {
    const name = `${step.kind}:${step.url ?? ''}`;
    const before = steps.slice(0, index).filter((one) => `${one.kind}:${one.url ?? ''}` === name).length;
    return {step, index, key: `${name}#${before}`};
  });

const STRATEGIES = [
  'id',
  'accessibility id',
  'xpath',
  '-android uiautomator',
  '-ios predicate string',
  '-ios class chain',
];
const PARTS = ['login', 'password', 'submit'];

/** The login and password of an account, typed here and kept in the keychain only. */
const SecretDialog = ({account, onClose, onSaved}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => {
    setLogin('');
    setPassword('');
  }, [account]);
  return (
    <Modal
      open={!!account}
      title={t('playbookSecretTitle', {name: account?.name ?? ''})}
      okText={t('Save')}
      cancelText={t('Cancel')}
      okButtonProps={{disabled: !login || !password}}
      onCancel={onClose}
      onOk={async () => {
        // the compiler reads what a closure uses on every render: the account may be none yet
        const id = account?.id;
        if (!id) {
          return;
        }
        try {
          onSaved(id, await backend.playbook.setSecret(id, {login, password}));
        } catch (error) {
          message.error(error.message);
        }
      }}
      destroyOnHidden
    >
      <div className={styles.profileApps}>
        <Input value={login} onChange={(e) => setLogin(e.target.value)} placeholder={t('playbookLogin')} />
        <Input.Password
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('playbookPassword')}
        />
        <span className={styles.profileHint}>{t('playbookSecretHint')}</span>
      </div>
    </Modal>
  );
};

/** A locator of the sign-in: written by hand, or taken from the element picked in the Inspector. */
const LocatorRow = ({part, value, onChange}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const inspector = useSelector((state) => state.inspector);
  const best = inspector.selectedElement?.strategyMap?.[0] ?? null;
  const picked = best ? {using: best[0], value: best[1]} : null;
  const check = async () => {
    try {
      const found = await inspector.driver.findElements(value.using, value.value);
      message[found.length ? 'success' : 'warning'](
        t(found.length ? 'playbookFound' : 'playbookNotFound', {count: found.length}),
      );
    } catch (error) {
      message.error(error.message);
    }
  };
  return (
    <div className={styles.mcpRow}>
      <span className={styles.playbookLabel}>{t(`playbookPart_${part}`)}</span>
      <Select
        size="small"
        value={value?.using ?? 'id'}
        options={STRATEGIES.map((one) => ({value: one, label: one}))}
        onChange={(using) => onChange({using, value: value?.value ?? ''})}
        className={styles.playbookShort}
      />
      <Input
        size="small"
        className={`${styles.mono} ${styles.playbookField}`}
        value={value?.value ?? ''}
        placeholder={t('playbookAuto')}
        onChange={(e) => onChange(e.target.value ? {using: value?.using ?? 'id', value: e.target.value} : null)}
      />
      <Button
        size="small"
        icon={<IconTarget size={14} />}
        disabled={!picked}
        title={picked ? undefined : t('playbookPickHint')}
        onClick={() => onChange(picked)}
      >
        {t('playbookFromInspector')}
      </Button>
      <Button size="small" disabled={!value?.value || !inspector.driver} onClick={check}>
        {t('settingsCheck')}
      </Button>
    </div>
  );
};

/**
 * The app's playbook in the profile: the accounts and what each is for, the
 * sign-in, what the agent may do on the device, what it must never touch,
 * and how the app goes back to its start.
 */
const PlaybookSettings = () => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const profiles = useProfiles();
  const [book, setBook] = useState(null);
  const [ready, setReady] = useState({});
  const [editing, setEditing] = useState(null);
  const [platform, setPlatform] = useState('android');
  const [trying, setTrying] = useState(null);
  const [link, setLink] = useState('');

  useEffect(() => {
    getSetting(APP_PLAYBOOK).then((saved) => setBook(cleanPlaybook(saved)));
  }, [profiles.activeId]);
  useEffect(() => {
    if (book && backend.playbook) {
      backend.playbook.secretState(book.accounts.map((account) => account.id)).then(setReady);
    }
    // only a new or removed account asks the keychain again
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.accounts.map((account) => account.id).join(',')]);

  if (!book || !backend.playbook) {
    return null;
  }
  // names are typed letter by letter: the setting keeps the clean form, the field what was typed
  const save = async (next) => {
    setBook(next);
    await setSetting(APP_PLAYBOOK, cleanPlaybook(next));
  };
  const setAccount = (id, patch) =>
    save({...book, accounts: book.accounts.map((account) => (account.id === id ? {...account, ...patch} : account))});
  const setRule = (id, patch) =>
    save({...book, forbidden: book.forbidden.map((rule) => (rule.id === id ? {...rule, ...patch} : rule))});
  const locators = book.login[platform] ?? {};
  const steps = book.reset[platform] ?? [];

  const tryLogin = async (account) => {
    setTrying(account.id);
    try {
      const result = await backend.playbook.tryLogin(account.name);
      message[result.ok && /^Signed in/.test(result.text) ? 'success' : 'warning'](result.text);
    } finally {
      setTrying(null);
    }
  };

  return (
    <section className={`${styles.card} ${styles.cardOpen}`} aria-label={t('playbookTitle')}>
      <div className={styles.cardHead}>
        <span className={`${styles.logo} ${styles.logo_ai}`}>
          <IconBook2 size={18} stroke={1.7} />
        </span>
        <span className={styles.cardTitleBlock}>
          <span className={styles.cardTitle}>{t('playbookTitle')}</span>
          <span className={styles.cardPurpose}>{t('playbookPurpose')}</span>
        </span>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.profileApps}>
          <span className={styles.agentLabel}>{t('playbookAccounts')}</span>
          {book.accounts.map((account) => (
            <div key={account.id} className={styles.mcpRow}>
              <Input
                size="small"
                className={`${styles.mono} ${styles.playbookShort}`}
                value={account.name}
                placeholder={t('playbookAccountName')}
                onChange={(e) => setAccount(account.id, {name: e.target.value})}
              />
              <Input
                size="small"
                className={styles.playbookField}
                value={account.purpose}
                placeholder={t('playbookAccountPurpose')}
                onChange={(e) => setAccount(account.id, {purpose: e.target.value})}
              />
              {ready[account.id] ? (
                <Tag color="success">{t('playbookSecretSaved')}</Tag>
              ) : (
                <Tag color="warning">{t('playbookSecretMissing')}</Tag>
              )}
              <Button size="small" icon={<IconKey size={14} />} onClick={() => setEditing(account)}>
                {t('playbookSecretSet')}
              </Button>
              <Button
                size="small"
                icon={<IconLogin size={14} />}
                disabled={!ready[account.id] || !account.name}
                loading={trying === account.id}
                onClick={() => tryLogin(account)}
              >
                {t('playbookTryLogin')}
              </Button>
              <Button
                size="small"
                type="text"
                danger
                icon={<IconTrash size={14} />}
                aria-label={t('playbookRemove')}
                onClick={async () => {
                  await backend.playbook.setSecret(account.id, {login: '', password: ''});
                  await save({...book, accounts: book.accounts.filter((one) => one.id !== account.id)});
                }}
              />
            </div>
          ))}
          <div className={styles.sourceActions}>
            <Button
              size="small"
              icon={<IconPlus size={14} />}
              onClick={() => setBook({...book, accounts: [...book.accounts, newAccount()]})}
            >
              {t('playbookAddAccount')}
            </Button>
          </div>
          <span className={styles.profileHint}>{t('playbookAccountsHint')}</span>

          <span className={styles.agentLabel}>{t('playbookPermissions')}</span>
          {PERMISSION_GROUPS.map((group) => (
            <div key={group} className={styles.mcpRow}>
              <span>{t(`playbookGroup_${group}`)}</span>
              <span className={styles.spacer} />
              <Segmented
                size="small"
                value={book.permissions[group]}
                options={PERMISSION_VALUES.map((value) => ({value, label: t(`playbookPermission_${value}`)}))}
                onChange={(value) => save({...book, permissions: {...book.permissions, [group]: value}})}
              />
            </div>
          ))}
          <span className={styles.profileHint}>{t('playbookPermissionsHint')}</span>

          <span className={styles.agentLabel}>{t('playbookForbidden')}</span>
          {book.forbidden.map((rule) => (
            <div key={rule.id} className={styles.mcpRow}>
              <Select
                size="small"
                value={rule.kind}
                options={FORBIDDEN_KINDS.map((kind) => ({value: kind, label: t(`playbookForbid_${kind}`)}))}
                onChange={(kind) => setRule(rule.id, {kind})}
                className={styles.playbookShort}
              />
              <Input
                size="small"
                className={styles.playbookField}
                value={rule.value}
                placeholder={t('playbookForbidValue')}
                onChange={(e) => setRule(rule.id, {value: e.target.value})}
              />
              <Input
                size="small"
                className={styles.playbookField}
                value={rule.why}
                placeholder={t('playbookForbidWhy')}
                onChange={(e) => setRule(rule.id, {why: e.target.value})}
              />
              <Button
                size="small"
                type="text"
                danger
                icon={<IconTrash size={14} />}
                aria-label={t('playbookRemove')}
                onClick={() => save({...book, forbidden: book.forbidden.filter((one) => one.id !== rule.id)})}
              />
            </div>
          ))}
          <div className={styles.sourceActions}>
            <Button
              size="small"
              icon={<IconPlus size={14} />}
              onClick={() => setBook({...book, forbidden: [...book.forbidden, newForbidden()]})}
            >
              {t('playbookAddForbidden')}
            </Button>
          </div>

          <div className={styles.mcpRow}>
            <span className={styles.agentLabel}>{t('playbookLoginAndReset')}</span>
            <span className={styles.spacer} />
            <Segmented
              size="small"
              value={platform}
              options={[
                {value: 'android', label: 'Android'},
                {value: 'ios', label: 'iOS'},
              ]}
              onChange={setPlatform}
            />
          </div>
          {PARTS.map((part) => (
            <LocatorRow
              key={part}
              part={part}
              value={locators[part] ?? null}
              onChange={(locator) => {
                const next = {...locators};
                if (locator) {
                  next[part] = locator;
                } else {
                  delete next[part];
                }
                save({...book, login: {...book.login, [platform]: next}});
              }}
            />
          ))}
          <span className={styles.profileHint}>{t('playbookLoginHint')}</span>
          <div className={styles.mcpRow}>
            <span>{t('playbookReset')}</span>
            {stepKeys(steps).map(({step, key, index}) => (
              <Tag
                key={key}
                closable
                onClose={() =>
                  save({...book, reset: {...book.reset, [platform]: steps.filter((_one, at) => at !== index)}})
                }
              >
                {step.kind === 'deeplink' ? step.url : t(`playbookReset_${step.kind}`)}
              </Tag>
            ))}
            <Select
              size="small"
              value={null}
              placeholder={t('playbookResetAdd')}
              options={['restart', 'clear'].map((kind) => ({value: kind, label: t(`playbookReset_${kind}`)}))}
              className={styles.playbookShort}
              onChange={(kind) => save({...book, reset: {...book.reset, [platform]: [...steps, {kind}]}})}
            />
            <Input.Search
              size="small"
              className={`${styles.mono} ${styles.playbookField}`}
              placeholder={t('playbookResetUrl')}
              enterButton={t('playbookResetAddLink')}
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onSearch={(url) => {
                if (url.trim()) {
                  setLink('');
                  save({...book, reset: {...book.reset, [platform]: [...steps, {kind: 'deeplink', url: url.trim()}]}});
                }
              }}
            />
          </div>
          <span className={styles.profileHint}>{t('playbookResetHint')}</span>
          <span className={styles.profileHint}>{t('playbookNextConversation')}</span>
        </div>
      </div>
      <SecretDialog
        account={editing}
        onClose={() => setEditing(null)}
        onSaved={(id, done) => {
          setEditing(null);
          setReady((current) => ({...current, [id]: done}));
          if (done) {
            message.success(t('playbookSecretSaved'));
          }
        }}
      />
    </section>
  );
};

export default PlaybookSettings;
