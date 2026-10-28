import {AutoComplete} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';

import {activeDevice, devicePlatform} from '../../actions/Workstation.js';
import {setProfileApps} from '../../lib/settings/profiles-store.js';

import styles from '../Settings/SettingsPage.module.css';

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

export default ProjectAppField;
