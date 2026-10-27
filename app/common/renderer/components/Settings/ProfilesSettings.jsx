import {IconCopy, IconDownload, IconFolders, IconPencil, IconPlus, IconTrash} from '@tabler/icons-react';
import {App, AutoComplete, Button, Input, Modal, Popconfirm, Tooltip} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';

import {activeDevice, devicePlatform} from '../../actions/Workstation.js';
import {
  addProfile,
  removeProfile,
  renameProfile,
  setProfileApps,
  switchProfile,
  useProfiles,
} from '../../lib/settings/profiles-store.js';
import {ExportDialog} from './StationTransfer.jsx';

import styles from './SettingsPage.module.css';

/**
 * Asks for a name: for a new profile, a copy, or a new name.
 */
export const NameDialog = ({open, title, initial = '', onOk, onCancel}) => {
  const {t} = useTranslation();
  const [name, setName] = useState(initial);
  // a fresh name each time it opens, before anything is typed
  useEffect(() => {
    if (open) {
      setName(initial);
    }
  }, [open, initial]);
  return (
    <Modal
      open={open}
      title={title}
      okText={t('settingsProfileSave')}
      okButtonProps={{disabled: !name.trim()}}
      onOk={() => onOk(name.trim())}
      cancelText={t('Cancel')}
      onCancel={onCancel}
      destroyOnHidden
    >
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onPressEnter={() => name.trim() && onOk(name.trim())}
      />
    </Modal>
  );
};

/**
 * The app of a project on one platform: typed, or taken from the apps of the
 * active device when it runs this platform. Saved when the field is left, so
 * the station does not pick the app again on every key.
 */
const ProjectAppField = ({profile, platform}) => {
  const {t} = useTranslation();
  const saved = profile.apps.find((app) => app.platform === platform)?.id ?? '';
  const [value, setValue] = useState(saved);
  const {apps, device} = useSelector((state) => ({
    apps: state.workstation.apps,
    device: activeDevice(state.workstation),
  }));
  useEffect(() => setValue(saved), [saved]);

  const save = (next) => {
    const id = next.trim();
    if (id === saved) {
      return;
    }
    const others = profile.apps.filter((app) => app.platform !== platform && app.id !== id);
    setProfileApps(profile.id, id ? [{id, platform}, ...others] : others);
  };
  const needle = value.trim().toLowerCase();
  const options =
    devicePlatform(device) === platform
      ? apps
          .filter((app) => !needle || app.id.toLowerCase().includes(needle) || app.name?.toLowerCase().includes(needle))
          .slice(0, 40)
          .map((app) => ({
            value: app.id,
            label: (
              <span className={styles.appOption}>
                <span className={styles.mono}>{app.id}</span>
                {app.name && app.name !== app.id && <span className={styles.profileHint}>{app.name}</span>}
              </span>
            ),
          }))
      : [];

  return (
    <label className={styles.profileApp}>
      <span className={styles.profileAppPlatform}>{t(`settingsProfileApp_${platform}`)}</span>
      <AutoComplete
        value={value}
        options={options}
        onChange={setValue}
        onSelect={(id) => {
          setValue(id);
          save(id);
        }}
        onBlur={() => save(value)}
        onKeyDown={(e) => e.key === 'Enter' && save(value)}
        placeholder={platform === 'android' ? 'ua.acme.bank' : 'ua.acme.bank.ios'}
        allowClear
        onClear={() => save('')}
        className={styles.mono}
      />
    </label>
  );
};

const ProfileCard = ({profile, active, onlyOne}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const [renaming, setRenaming] = useState(false);
  const [exporting, setExporting] = useState(false);
  // ids saved before the platforms, until they are typed into a field
  const unplaced = profile.apps.filter((app) => !app.platform);

  return (
    <section className={`${styles.card} ${styles.cardOpen}`} aria-label={profile.name}>
      <div className={styles.cardHead}>
        <span className={`${styles.logo} ${styles.logo_device}`}>
          <IconFolders size={18} stroke={1.7} />
        </span>
        <div className={styles.cardTitleBlock}>
          <span className={styles.cardTitle}>{profile.name}</span>
          <span className={styles.cardPurpose}>
            {t('settingsProfileUpdated', {date: new Date(profile.updatedAt).toLocaleString()})}
          </span>
        </div>
        {active ? (
          <span className={`${styles.status} ${styles.statusOn}`}>
            <span className={styles.statusDot} />
            {t('settingsProfileActive')}
          </span>
        ) : (
          <Button size="small" onClick={() => switchProfile(profile.id)}>
            {t('settingsProfileTurnOn')}
          </Button>
        )}
      </div>
      <div className={styles.cardBody}>
        <div className={styles.profileApps}>
          <span>{t('settingsProfileApps')}</span>
          <ProjectAppField profile={profile} platform="android" />
          <ProjectAppField profile={profile} platform="ios" />
          {unplaced.length > 0 && (
            <span className={styles.profileHint}>
              {t('settingsProfileAppsUnplaced', {ids: unplaced.map((app) => app.id).join(', ')})}
            </span>
          )}
          <span className={styles.profileHint}>{t('settingsProfileAppsHint')}</span>
        </div>
      </div>
      <div className={styles.cardFoot}>
        <Button icon={<IconPencil size={16} />} onClick={() => setRenaming(true)}>
          {t('settingsProfileRename')}
        </Button>
        <Button icon={<IconDownload size={16} />} onClick={() => setExporting(true)}>
          {t('settingsProfileExport')}
        </Button>
        <Tooltip title={onlyOne ? t('settingsProfileLast') : null}>
          <Popconfirm
            title={t('settingsProfileDeleteAsk', {name: profile.name})}
            description={t('settingsProfileDeleteHint')}
            okText={t('settingsProfileDelete')}
            cancelText={t('Cancel')}
            okButtonProps={{danger: true}}
            disabled={onlyOne}
            onConfirm={async () => {
              await removeProfile(profile.id);
              message.success(t('settingsProfileDeleted'));
            }}
          >
            <Button danger type="text" icon={<IconTrash size={16} />} disabled={onlyOne} className={styles.disconnect}>
              {t('settingsProfileDelete')}
            </Button>
          </Popconfirm>
        </Tooltip>
      </div>
      <NameDialog
        open={renaming}
        title={t('settingsProfileRename')}
        initial={profile.name}
        onCancel={() => setRenaming(false)}
        onOk={async (name) => {
          setRenaming(false);
          await renameProfile(profile.id, name);
        }}
      />
      <ExportDialog open={exporting} kind="profile" profile={profile} onClose={() => setExporting(false)} />
    </section>
  );
};

/**
 * The project profiles: each holds the rules, filters and choices of one
 * project; the one that is on is what the tools use.
 */
const ProfilesSettings = () => {
  const {t} = useTranslation();
  const profiles = useProfiles();
  const [creating, setCreating] = useState(null);

  if (!profiles.loaded) {
    return null;
  }
  const active = profiles.list.find((profile) => profile.id === profiles.activeId);

  return (
    <>
      <div className={styles.profileActions}>
        <Button type="primary" icon={<IconPlus size={16} />} onClick={() => setCreating('empty')}>
          {t('settingsProfileNew')}
        </Button>
        <Button icon={<IconCopy size={16} />} onClick={() => setCreating('copy')}>
          {t('settingsProfileCopy', {name: active?.name ?? ''})}
        </Button>
      </div>
      {profiles.list.map((profile) => (
        <ProfileCard
          key={profile.id}
          profile={profile}
          active={profile.id === profiles.activeId}
          onlyOne={profiles.list.length < 2}
        />
      ))}
      <NameDialog
        open={!!creating}
        title={creating === 'copy' ? t('settingsProfileCopy', {name: active?.name ?? ''}) : t('settingsProfileNew')}
        initial={creating === 'copy' ? `${active?.name ?? ''}` : ''}
        onCancel={() => setCreating(null)}
        onOk={async (name) => {
          const copy = creating === 'copy';
          setCreating(null);
          await addProfile(name, {copy});
        }}
      />
    </>
  );
};

export default ProfilesSettings;
