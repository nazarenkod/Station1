import {IconCopy, IconDownload, IconFolders, IconPencil, IconPlus, IconTrash} from '@tabler/icons-react';
import {App, Button, Input, Modal, Popconfirm, Select, Tooltip} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

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

const ProfileCard = ({profile, active, onlyOne}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const [renaming, setRenaming] = useState(false);
  const [exporting, setExporting] = useState(false);

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
        <label className={styles.profileApps}>
          <span>{t('settingsProfileApps')}</span>
          <Select
            mode="tags"
            value={profile.apps}
            onChange={(apps) => setProfileApps(profile.id, apps)}
            tokenSeparators={[',', ' ']}
            placeholder="ua.acme.bank"
            open={false}
            suffixIcon={null}
            className={styles.mono}
          />
          <span className={styles.profileHint}>{t('settingsProfileAppsHint')}</span>
        </label>
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
