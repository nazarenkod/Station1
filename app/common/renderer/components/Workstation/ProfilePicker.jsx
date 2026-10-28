import {IconChevronDown, IconFolders, IconPlus, IconSettings} from '@tabler/icons-react';
import {Button, Popover} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {platformOfDevice} from '../../../shared/settings/platforms.js';
import {activeDevice} from '../../actions/Workstation.js';
import {problemFor, useStartProblems} from '../../lib/session/test-run.js';
import {addProfile, switchProfile, useProfiles} from '../../lib/settings/profiles-store.js';
import {adviceText, useProjectAdvice} from '../../lib/settings/project-advice.js';
import {backend} from '../../polyfills.js';
import NameDialog from '../Projects/NameDialog.jsx';
import {PLATFORM_ICONS} from '../Settings/ProjectPlatforms.jsx';
import {AdviceActions} from './ProjectAdvice.jsx';

import styles from './Workstation.module.css';

/**
 * The project profile the tools work by: its apps, rules, filters and choices.
 * The station works with the project app the device has.
 */
const ProfilePicker = () => {
  const {t} = useTranslation();
  // «Start session» waits for this one: it is outlined
  const problem = problemFor(useStartProblems(), 'app');
  const attention = problem
    ? `${styles.pickerAttention} ${problem.severity === 'error' ? styles.pickerAttention_error : ''}`
    : '';
  const navigate = useNavigate();
  const profiles = useProfiles();
  const advice = useProjectAdvice();
  const device = useSelector((state) => activeDevice(state.workstation));
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
            <span className={styles.menuItemPlatforms}>
              {profile.name}
              {(profile.platforms ?? []).map((platform) => {
                const Icon = PLATFORM_ICONS[platform];
                return Icon ? <Icon key={platform} size={13} aria-label={t(`settingsPlatform_${platform}`)} /> : null;
              })}
            </span>
            {profile.apps.length > 0 && (
              <span className={`${styles.menuItemSub} ${styles.mono}`}>
                {profile.apps.map((app) => app.id).join(' · ')}
              </span>
            )}
          </span>
        </button>
      ))}
      {advice && (
        <div className={styles.menuHint}>
          {adviceText(t, advice)}
          <div className={styles.menuHintActions} onClick={() => setOpen(false)}>
            <AdviceActions advice={advice} size="small" />
          </div>
        </div>
      )}
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
            navigate('/projects');
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
        <button className={`${styles.picker} ${attention}`} aria-label={t('wsPickProfile')} title={t('wsPickProfile')}>
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
          await addProfile(name, {platforms: [platformOfDevice(device) ?? 'android']});
        }}
      />
    </>
  );
};

export default ProfilePicker;
