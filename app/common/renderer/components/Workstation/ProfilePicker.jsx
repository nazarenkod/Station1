import {IconChevronDown, IconFolders, IconPlus, IconSettings} from '@tabler/icons-react';
import {Button, Popover} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router';

import {addProfile, switchProfile, useProfiles} from '../../lib/settings/profiles-store.js';
import {backend} from '../../polyfills.js';
import {NameDialog} from '../Settings/ProfilesSettings.jsx';

import styles from './Workstation.module.css';

/**
 * The project profile the tools work by: its rules, filters and choices.
 */
const ProfilePicker = () => {
  const {t} = useTranslation();
  const navigate = useNavigate();
  const profiles = useProfiles();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  if (!backend.settings || !profiles.loaded) {
    return null;
  }
  const active = profiles.list.find((profile) => profile.id === profiles.activeId);

  const content = (
    <div className={styles.menu}>
      <div className={styles.menuLabel}>{t('wsProfiles')}</div>
      {profiles.list.map((profile) => (
        <button
          key={profile.id}
          className={`${styles.menuItem} ${profile.id === profiles.activeId ? styles.menuItemActive : ''}`}
          onClick={() => {
            setOpen(false);
            switchProfile(profile.id);
          }}
        >
          <span className={styles.menuItemText}>
            <span>{profile.name}</span>
            {profile.apps.length > 0 && (
              <span className={`${styles.menuItemSub} ${styles.mono}`}>{profile.apps.join(', ')}</span>
            )}
          </span>
        </button>
      ))}
      <div className={styles.menuFooter}>
        <Button
          size="small"
          icon={<IconPlus size={14} />}
          onClick={() => {
            setOpen(false);
            setCreating(true);
          }}
        >
          {t('settingsProfileNew')}
        </Button>
        <Button
          size="small"
          type="text"
          icon={<IconSettings size={14} />}
          onClick={() => {
            setOpen(false);
            navigate('/settings', {state: {section: 'profiles'}});
          }}
        >
          {t('wsProfilesManage')}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <Popover
        content={content}
        trigger="click"
        placement="bottomLeft"
        open={open}
        onOpenChange={setOpen}
        arrow={false}
      >
        <button className={styles.picker} aria-label={t('wsPickProfile')} title={t('wsPickProfile')}>
          <IconFolders size={16} stroke={1.6} />
          <span className={styles.pickerMain}>{active?.name ?? t('wsPickProfile')}</span>
          <IconChevronDown size={14} opacity={0.6} />
        </button>
      </Popover>
      <NameDialog
        open={creating}
        title={t('settingsProfileNew')}
        onCancel={() => setCreating(false)}
        onOk={async (name) => {
          setCreating(false);
          await addProfile(name);
        }}
      />
    </>
  );
};

export default ProfilePicker;
