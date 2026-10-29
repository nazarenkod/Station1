import {IconBrandGit, IconCode, IconEye, IconFolderOpen, IconTrash} from '@tabler/icons-react';
import {Button, Input, Popconfirm, Spin, Tag, Tooltip} from 'antd';
import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {cleanAutotestsConfig} from '../../../shared/autotests/config.js';
import {AUTOTESTS_CONFIG} from '../../../shared/setting-defs.js';
import {useProfiles} from '../../lib/settings/profiles-store.js';
import {backend, getSetting, setSetting} from '../../polyfills.js';
import PackageView from './PackageView.jsx';

import settingsStyles from '../Settings/SettingsPage.module.css';
import styles from './Autotests.module.css';

/** A path inside the repository, saved when the field is left. */
const PathField = ({label, value, placeholder, onSave, warn}) => {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className={styles.pathRow}>
      <span className={styles.fieldLabel}>{label}</span>
      <Input
        size="small"
        className={styles.mono}
        value={text}
        placeholder={placeholder}
        status={warn ? 'warning' : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onSave(text)}
      />
    </label>
  );
};

/**
 * The project's autotests: the repository the rules and the examples are
 * read from, and the packages of screen objects saved after sessions. Only
 * the project that is on: the rules are its live settings.
 */
const AutotestsSettings = ({focused}) => {
  const {t} = useTranslation();
  const profiles = useProfiles();
  const ref = useRef(null);
  const [repo, setRepo] = useState(null);
  const [config, setConfig] = useState(null);
  const [packages, setPackages] = useState(null);
  const [opened, setOpened] = useState(null);

  const refresh = async () => {
    setRepo(await backend.autotests.inspect());
    setPackages(await backend.autotests.packages());
  };
  useEffect(() => {
    getSetting(AUTOTESTS_CONFIG).then((saved) => setConfig(cleanAutotestsConfig(saved)));
    refresh();
    // the packages change after a session ends, on any tab
    return backend.autotests.onChanged(() => backend.autotests.packages().then(setPackages));
  }, [profiles.activeId]);
  useEffect(() => {
    if (focused) {
      ref.current?.scrollIntoView({behavior: 'smooth', block: 'start'});
    }
  }, [focused]);

  if (!config) {
    return null;
  }
  const save = async (patch) => {
    const next = cleanAutotestsConfig({...config, ...patch});
    setConfig(next);
    await setSetting(AUTOTESTS_CONFIG, next);
    setRepo(await backend.autotests.inspect());
  };
  const pickFolder = async () => {
    const folder = await backend.source.pickFolder();
    if (folder) {
      setRepo(await backend.autotests.setPath(folder));
    }
  };
  const missing = new Set(repo?.missing ?? []);

  return (
    <section ref={ref} className={`${settingsStyles.card} ${settingsStyles.cardOpen}`} aria-label={t('autotestsTitle')}>
      <div className={settingsStyles.cardHead}>
        <span className={`${settingsStyles.logo} ${settingsStyles.logo_ai}`}>
          <IconCode size={18} stroke={1.7} />
        </span>
        <span className={settingsStyles.cardTitleBlock}>
          <span className={settingsStyles.cardTitle}>{t('autotestsTitle')}</span>
          <span className={settingsStyles.cardPurpose}>{t('autotestsPurpose')}</span>
        </span>
      </div>
      <div className={settingsStyles.cardBody}>
        <div className={settingsStyles.profileApps}>
          <div className={styles.package}>
            <IconBrandGit size={18} stroke={1.6} />
            {!repo ? (
              <Spin size="small" />
            ) : repo.path ? (
              <span className={styles.packageText}>
                <Tooltip title={repo.path} placement="bottomLeft">
                  <span className={`${styles.mono} ${styles.packageName}`}>{repo.shown || repo.path}</span>
                </Tooltip>
                <span className={styles.packageMeta}>
                  {repo.ok
                    ? [repo.branch ?? t('autotestsDetached'), repo.remote].filter(Boolean).join(' · ')
                    : t(`settingsSourceErr_${repo.error}`, {defaultValue: t('autotestsNotRepo')})}
                </span>
              </span>
            ) : (
              <span className={`${styles.hint} ${styles.packageText}`}>{t('autotestsNoFolder')}</span>
            )}
            <Button
              size="small"
              type={repo?.path ? 'default' : 'primary'}
              icon={<IconFolderOpen size={14} />}
              onClick={pickFolder}
            >
              {t('settingsSourcePickFolder')}
            </Button>
            {repo?.path && (
              <Tooltip title={t('autotestsForget')}>
                <Button
                  size="small"
                  type="text"
                  icon={<IconTrash size={14} />}
                  aria-label={t('autotestsForget')}
                  onClick={async () => setRepo(await backend.autotests.setPath(null))}
                />
              </Tooltip>
            )}
          </div>
          <PathField
            label={t('autotestsRules')}
            value={config.rules}
            placeholder=".station/screen-objects.md"
            warn={repo?.ok && missing.has('rules')}
            onSave={(rules) => save({rules})}
          />
          <PathField
            label={t('autotestsExamples')}
            value={config.examples}
            placeholder="src/test/kotlin/…/screens"
            warn={repo?.ok && missing.has('examples')}
            onSave={(examples) => save({examples})}
          />
          {repo?.ok && missing.has('rules') && (
            <span className={settingsStyles.sourceWarn}>{t('autotestsRulesMissing', {path: config.rules})}</span>
          )}
          {repo?.ok && missing.has('examples') && (
            <span className={settingsStyles.sourceWarn}>{t('autotestsExamplesMissing', {path: config.examples})}</span>
          )}
          {repo?.ok && repo.examples?.found && (
            <span className={settingsStyles.profileHint}>
              {t('autotestsExamplesFound', {count: repo.examples.files})}
            </span>
          )}
          <span className={settingsStyles.profileHint}>{t('autotestsRepoHint')}</span>

          <span className={settingsStyles.agentLabel}>{t('autotestsPackages')}</span>
          {packages?.length ? (
            <div className={styles.packages}>
              {packages.map((pack) => (
                <div key={pack.id} className={styles.package}>
                  <span className={styles.packageText}>
                    <span className={styles.packageName}>{pack.name}</span>
                    <span className={styles.packageMeta}>
                      {[
                        new Date(pack.createdAt).toLocaleString(),
                        t(`settingsPlatform_${pack.platform}`),
                        pack.app?.version ? `${pack.app.id} ${pack.app.version}` : pack.app?.id,
                        t('autotestsPackageMeta', {count: pack.objects, generated: pack.generated}),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {pack.ready && <Tag color="blue">{t('autotestsReadyTag')}</Tag>}
                  {pack.takenAt && <Tag color="green">{t('autotestsTakenTag')}</Tag>}
                  <Button size="small" icon={<IconEye size={14} />} onClick={() => setOpened(pack.id)}>
                    {t('autotestsOpenPackage')}
                  </Button>
                  <Popconfirm
                    title={t('autotestsRemoveAsk', {name: pack.name})}
                    okText={t('autotestsRemove')}
                    cancelText={t('Cancel')}
                    okButtonProps={{danger: true}}
                    onConfirm={async () => {
                      await backend.autotests.remove(pack.id);
                      setPackages(await backend.autotests.packages());
                    }}
                  >
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<IconTrash size={14} />}
                      aria-label={t('autotestsRemove')}
                    />
                  </Popconfirm>
                </div>
              ))}
            </div>
          ) : (
            <span className={settingsStyles.profileHint}>{t('autotestsNoPackages')}</span>
          )}
        </div>
      </div>
      <PackageView
        packageId={opened}
        onClose={async () => {
          setOpened(null);
          setPackages(await backend.autotests.packages());
        }}
      />
    </section>
  );
};

export default AutotestsSettings;
