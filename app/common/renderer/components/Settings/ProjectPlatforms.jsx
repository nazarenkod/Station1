import {IconBrandAndroid, IconBrandApple, IconDots, IconLayersLinked, IconPlus} from '@tabler/icons-react';
import {App, Button, Dropdown, Tabs} from 'antd';
import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';

import {platformKey, platformOfDevice} from '../../../shared/settings/platforms.js';
import {activeDevice} from '../../actions/Workstation.js';
import {setProfilePlatforms} from '../../lib/settings/profiles-store.js';
import BuildSourcesSettings from './BuildSourcesSettings.jsx';
import {BranchFields, RepoList, useSourceInfos} from './SourceSettings.jsx';

import styles from './SettingsPage.module.css';

export const PLATFORM_ICONS = {android: IconBrandAndroid, ios: IconBrandApple, multi: IconLayersLinked};

/** One part of a platform: its title and what is in it. */
const Part = ({title, hint, children, focused}) => {
  const ref = useRef(null);
  useEffect(() => {
    if (focused) {
      ref.current?.scrollIntoView({behavior: 'smooth', block: 'center'});
    }
  }, [focused]);
  return (
    <div ref={ref} className={`${styles.platformPart} ${focused ? styles.platformPartFocused : ''}`}>
      <span className={styles.platformPartTitle}>{title}</span>
      {children}
      {hint && <span className={styles.profileHint}>{hint}</span>}
    </div>
  );
};

/**
 * The platforms of a project, a tab each: its app, branches, repositories
 * with their submodules and its build sources; below, the code the platforms
 * share. One «multi» tab when one code makes the Android and iOS apps.
 * `AppField` is the field of a project app on a platform.
 */
const ProjectPlatforms = ({profile, active, focus, AppField}) => {
  const {t} = useTranslation();
  const {modal} = App.useApp();
  const device = useSelector((state) => activeDevice(state.workstation));
  const {infos, refresh} = useSourceInfos(profile);
  const platforms = profile.platforms ?? ['android'];
  const multi = platforms.includes('multi');
  const fromDevice = platformKey(profile, platformOfDevice(device));
  const asked = active && focus ? (focus.platform ?? fromDevice) : null;
  const [tab, setTab] = useState(asked ?? fromDevice ?? platforms[0]);
  const shown = platforms.includes(tab) ? tab : platforms[0];

  useEffect(() => {
    if (asked && platforms.includes(asked)) {
      setTab(asked);
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

  const add = (platform) => {
    setTab(platform);
    setProfilePlatforms(profile.id, [...platforms, platform]);
  };
  const remove = (platform) =>
    modal.confirm({
      title: t('settingsPlatformRemoveAsk', {platform: t(`settingsPlatform_${platform}`)}),
      content: t('settingsPlatformRemoveHint'),
      okText: t('settingsPlatformRemove'),
      okButtonProps: {danger: true},
      cancelText: t('Cancel'),
      onOk: () =>
        setProfilePlatforms(
          profile.id,
          platforms.filter((one) => one !== platform),
        ),
    });

  const missing = multi ? [] : ['android', 'ios'].filter((one) => !platforms.includes(one));
  const menu = [
    ...(!multi && platforms.length === 2
      ? [{key: 'multi', label: t('settingsPlatformMakeMulti'), onClick: () => setProfilePlatforms(profile.id, 'multi')}]
      : []),
    ...(multi
      ? [{key: 'split', label: t('settingsPlatformSplit'), onClick: () => setProfilePlatforms(profile.id, 'split')}]
      : []),
    ...(!multi && platforms.length > 1
      ? [
          {
            key: 'remove',
            danger: true,
            label: t('settingsPlatformRemoveOne', {platform: t(`settingsPlatform_${shown}`)}),
            onClick: () => remove(shown),
          },
        ]
      : []),
  ];
  // the field a link asked for, on the tab it asked for
  const field = active && focus && shown === asked ? focus.field : null;

  const section = (platform) => (
    <div className={styles.platformBody}>
      <Part title={t('settingsPlatformApp')} focused={active && field === 'app'}>
        {platform === 'multi' ? (
          <>
            <AppField profile={profile} platform="android" />
            <AppField profile={profile} platform="ios" />
          </>
        ) : (
          <AppField profile={profile} platform={platform} />
        )}
      </Part>
      <Part title={t('settingsPlatformCode')} focused={active && field === 'code'}>
        <BranchFields profile={profile} platform={platform} />
        <RepoList profile={profile} platform={platform} infos={infos} onRefresh={refresh} />
      </Part>
      <Part title={t('settingsPlatformBuilds')} focused={active && field === 'builds'}>
        {active ? (
          <BuildSourcesSettings
            platform={platform}
            platforms={platforms}
            openProject={field === 'builds' ? (focus?.project ?? null) : null}
          />
        ) : (
          <span className={styles.profileHint}>{t('settingsPlatformBuildsInactive')}</span>
        )}
      </Part>
    </div>
  );

  return (
    <div className={styles.platforms}>
      <Tabs
        activeKey={shown}
        onChange={setTab}
        items={platforms.map((platform) => {
          const Icon = PLATFORM_ICONS[platform];
          return {
            key: platform,
            label: (
              <span className={styles.platformTab}>
                <Icon size={16} />
                {t(`settingsPlatform_${platform}`)}
              </span>
            ),
            children: section(platform),
          };
        })}
        tabBarExtraContent={
          <span className={styles.platformAdd}>
            {missing.map((platform) => (
              <Button
                key={platform}
                size="small"
                type="text"
                icon={<IconPlus size={14} />}
                onClick={() => add(platform)}
              >
                {t(`settingsPlatform_${platform}`)}
              </Button>
            ))}
            {menu.length > 0 && (
              <Dropdown trigger={['click']} menu={{items: menu}}>
                <Button size="small" type="text" icon={<IconDots size={16} />} aria-label={t('settingsPlatformMore')} />
              </Dropdown>
            )}
          </span>
        }
      />
      <Part title={t('settingsPlatformShared')} hint={t('settingsPlatformSharedHint')}>
        <RepoList profile={profile} platform="shared" infos={infos} onRefresh={refresh} />
      </Part>
    </div>
  );
};

export default ProjectPlatforms;
