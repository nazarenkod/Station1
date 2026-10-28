import {IconCopy, IconDots, IconDownload, IconFolders, IconPencil, IconPlus, IconTrash} from '@tabler/icons-react';
import {App, Button, Dropdown, Tooltip} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';
import {useLocation} from 'react-router';

import {platformOfDevice} from '../../../shared/settings/platforms.js';
import {activeDevice} from '../../actions/Workstation.js';
import {
  addProfile,
  removeProfile,
  renameProfile,
  switchProfile,
  useProfiles,
} from '../../lib/settings/profiles-store.js';
import PlaybookSettings from '../Settings/PlaybookSettings.jsx';
import ProjectPlatforms, {PLATFORM_ICONS} from '../Settings/ProjectPlatforms.jsx';
import {ExportDialog} from '../Settings/StationTransfer.jsx';
import NameDialog from './NameDialog.jsx';
import ProjectAppField from './ProjectAppField.jsx';

import styles from './ProjectsPage.module.css';

const PlatformIcons = ({platforms, size = 14}) => {
  const {t} = useTranslation();
  return (
    <span className={styles.platformIcons}>
      {(platforms ?? []).map((platform) => {
        const Icon = PLATFORM_ICONS[platform];
        return Icon ? <Icon key={platform} size={size} aria-label={t(`settingsPlatform_${platform}`)} /> : null;
      })}
    </span>
  );
};

/**
 * One project: its name, whether the tools follow it, its platforms with
 * the app and code of each, and the app's playbook. Renaming, copying,
 * exporting and deleting wait in the «⋯» menu.
 */
const ProjectView = ({profile, active, onlyOne, focus}) => {
  const {t} = useTranslation();
  const {message, modal} = App.useApp();
  const [naming, setNaming] = useState(null);
  const [exporting, setExporting] = useState(false);
  // ids saved before the platforms, until they are typed into a field
  const unplaced = profile.apps.filter((app) => !app.platform);

  const remove = () =>
    modal.confirm({
      title: t('settingsProfileDeleteAsk', {name: profile.name}),
      content: t('settingsProfileDeleteHint'),
      okText: t('settingsProfileDelete'),
      okButtonProps: {danger: true},
      cancelText: t('Cancel'),
      onOk: async () => {
        await removeProfile(profile.id);
        message.success(t('settingsProfileDeleted'));
      },
    });

  const menu = [
    {
      key: 'rename',
      icon: <IconPencil size={16} />,
      label: t('settingsProfileRename'),
      onClick: () => setNaming('rename'),
    },
    // a copy is made of the project that is on, with its rules and code
    ...(active
      ? [{key: 'copy', icon: <IconCopy size={16} />, label: t('projectsCopy'), onClick: () => setNaming('copy')}]
      : []),
    {
      key: 'export',
      icon: <IconDownload size={16} />,
      label: t('settingsProfileExport'),
      onClick: () => setExporting(true),
    },
    {type: 'divider'},
    {
      key: 'delete',
      icon: <IconTrash size={16} />,
      danger: true,
      disabled: onlyOne,
      label: onlyOne ? t('settingsProfileLast') : t('settingsProfileDelete'),
      onClick: remove,
    },
  ];

  return (
    <section className={styles.project} aria-label={profile.name}>
      <header className={styles.projectHead}>
        <span className={styles.projectLogo}>
          <IconFolders size={22} stroke={1.6} />
        </span>
        <div className={styles.projectTitleBlock}>
          <Tooltip
            title={t('settingsProfileUpdated', {date: new Date(profile.updatedAt).toLocaleString()})}
            placement="bottomLeft"
          >
            <h2 className={styles.projectTitle}>{profile.name}</h2>
          </Tooltip>
          <PlatformIcons platforms={profile.platforms} size={15} />
        </div>
        {active ? (
          <span className={styles.activeBadge}>
            <span className={styles.activeDot} />
            {t('settingsProfileActive')}
          </span>
        ) : (
          <Button type="primary" onClick={() => switchProfile(profile.id)}>
            {t('settingsProfileTurnOn')}
          </Button>
        )}
        <Dropdown trigger={['click']} menu={{items: menu}} placement="bottomRight">
          <Button type="text" icon={<IconDots size={18} />} aria-label={t('projectsMore')} />
        </Dropdown>
      </header>
      <ProjectPlatforms profile={profile} active={active} focus={focus} AppField={ProjectAppField} />
      {unplaced.length > 0 && (
        <span className={styles.hint}>
          {t('settingsProfileAppsUnplaced', {ids: unplaced.map((app) => app.id).join(', ')})}
        </span>
      )}
      {/* the playbook follows the project that is on */}
      {active && <PlaybookSettings />}
      <NameDialog
        open={!!naming}
        title={naming === 'copy' ? t('projectsCopy') : t('settingsProfileRename')}
        initial={profile.name}
        onCancel={() => setNaming(null)}
        onOk={async (name) => {
          const copy = naming === 'copy';
          setNaming(null);
          await (copy ? addProfile(name, {copy: true}) : renameProfile(profile.id, name));
        }}
      />
      <ExportDialog open={exporting} kind="profile" profile={profile} onClose={() => setExporting(false)} />
    </section>
  );
};

/**
 * The projects: a list on the left, the chosen one on the right. The one
 * that is on is what the tools use; it opens first.
 */
const ProjectsPage = () => {
  const {t} = useTranslation();
  const profiles = useProfiles();
  // another screen can ask for a platform and a field: the advice of a project, a pipeline
  const {state} = useLocation();
  const focus = state?.focus ?? null;
  const [chosen, setChosen] = useState(null);
  const [creating, setCreating] = useState(false);
  // a new project starts with the platform of the device on the title bar
  const device = useSelector((store) => activeDevice(store.workstation));

  // a project switched on anywhere (the title bar, a new one) is the one shown
  useEffect(() => {
    setChosen(profiles.activeId);
  }, [profiles.activeId]);

  if (!profiles.loaded) {
    return null;
  }
  const shown = profiles.list.find((profile) => profile.id === chosen) ?? profiles.list[0];

  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <nav className={styles.list} aria-label={t('wsTool_projects')}>
          <h1 className={styles.title}>{t('wsTool_projects')}</h1>
          {profiles.list.map((profile) => {
            const isShown = profile.id === shown?.id;
            return (
              <button
                key={profile.id}
                type="button"
                className={`${styles.item} ${isShown ? styles.itemShown : ''}`}
                aria-current={isShown ? 'page' : undefined}
                onClick={() => setChosen(profile.id)}
              >
                <span className={styles.itemName}>{profile.name}</span>
                <PlatformIcons platforms={profile.platforms} />
                {profile.id === profiles.activeId && (
                  <span className={styles.activeDot} title={t('settingsProfileActive')} />
                )}
              </button>
            );
          })}
          <Button type="dashed" icon={<IconPlus size={16} />} onClick={() => setCreating(true)} className={styles.add}>
            {t('settingsProfileNew')}
          </Button>
        </nav>
        <div className={styles.content}>
          {shown && (
            <ProjectView
              key={shown.id}
              profile={shown}
              active={shown.id === profiles.activeId}
              onlyOne={profiles.list.length < 2}
              focus={shown.id === profiles.activeId ? focus : null}
            />
          )}
        </div>
      </div>
      <NameDialog
        open={creating}
        title={t('settingsProfileNew')}
        onCancel={() => setCreating(false)}
        onOk={async (name) => {
          setCreating(false);
          await addProfile(name, {platforms: [platformOfDevice(device) ?? 'android']});
        }}
      />
    </div>
  );
};

export default ProjectsPage;
