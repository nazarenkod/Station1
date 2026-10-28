import {
  IconBox,
  IconBoxMultiple,
  IconBrandSwift,
  IconChevronRight,
  IconFolderOpen,
  IconGitMerge,
  IconWorld,
} from '@tabler/icons-react';
import {Button, Tag, Tooltip} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';

import {DEPENDENCY_KINDS, describeDependencies, hostOf} from '../../../shared/settings/dependencies.js';
import {backend} from '../../polyfills.js';

import styles from './SettingsPage.module.css';

const KIND_ICONS = {submodule: IconGitMerge, spm: IconBrandSwift, pod: IconBox, gradle: IconBoxMultiple};

/** The last two parts of a folder: enough to tell it, the whole of it on hover. */
const shortFolder = (folder) => folder.split('/').slice(-2).join('/');

/**
 * One dependency: whether its code is here, its name and version; the
 * address and the folder on hover. The team's own may take a folder of its
 * own: asked for in a row with no code, offered on hover otherwise.
 */
const DependencyRow = ({dep, onPick, onClear}) => {
  const {t} = useTranslation();
  const name = dep.parent ? dep.path.slice(dep.parent.length + 1) : dep.kind === 'submodule' ? dep.path : dep.name;
  const where = [dep.url ?? dep.specRepo, dep.code.folder].filter(Boolean);
  // a library of others says where it comes from
  const host = dep.own ? null : dep.specRepo === 'trunk' ? 'CocoaPods' : hostOf(dep.url ?? dep.specRepo ?? '');

  return (
    <div className={`${styles.depRow} ${dep.depth ? styles.depNested : ''}`} style={{'--depth': dep.depth}}>
      <Tooltip title={t(`settingsDepStatus_${dep.code.status}`)}>
        <span className={`${styles.depDot} ${styles[`depDot_${dep.code.status}`]}`} />
      </Tooltip>
      <Tooltip
        title={
          where.length ? (
            <span className={styles.sourceTip}>
              {where.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </span>
          ) : null
        }
        placement="topLeft"
      >
        <span className={`${styles.mono} ${styles.depName}`}>{name}</span>
      </Tooltip>
      {dep.version && <span className={styles.depVersion}>{dep.version}</span>}
      {host && <span className={styles.depHost}>{host}</span>}
      <span className={styles.spacer} />
      {dep.own &&
        (dep.code.status === 'own' ? (
          <Tag
            closable
            onClose={(e) => {
              e.preventDefault();
              onClear(dep.key);
            }}
            title={dep.code.folder}
            className={`${styles.mono} ${styles.depFolder}`}
          >
            <IconFolderOpen size={12} />
            {shortFolder(dep.code.folder)}
          </Tag>
        ) : (
          <Tooltip title={t('settingsSourceModuleFolderHint')}>
            <Button
              size="small"
              type={dep.code.status === 'none' ? 'link' : 'text'}
              icon={<IconFolderOpen size={14} />}
              className={dep.code.status === 'none' ? '' : styles.depPick}
              onClick={() => onPick(dep.key)}
            >
              {dep.code.status === 'none' ? t('settingsDepPick') : t('settingsSourceModuleFolder')}
            </Button>
          </Tooltip>
        ))}
    </div>
  );
};

/** The dependencies of one kind under their icon and name. */
const DependencyGroup = ({kind, deps, onPick, onClear}) => {
  const {t} = useTranslation();
  const Icon = KIND_ICONS[kind];
  return (
    <div className={styles.depGroup}>
      <span className={styles.depGroupHead}>
        <Icon size={14} stroke={1.8} />
        {t(`settingsDepKind_${kind}`)}
        <span className={styles.depCount}>{deps.length}</span>
      </span>
      {deps.map((dep) => (
        <DependencyRow key={dep.key} dep={dep} onPick={onPick} onClear={onClear} />
      ))}
    </div>
  );
};

/**
 * The dependencies of a repository (project.dependencies): folded into one
 * line with how many there are and how many of the team's have no code; open,
 * the team's by kind and the libraries of others folded once more below.
 */
const DependencyList = ({profileId, repo, info, onRefresh}) => {
  const {t} = useTranslation();
  const [open, setOpen] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const deps = describeDependencies(info.state, info.modules ?? {});
  if (!deps.length) {
    return null;
  }
  const ours = deps.filter((dep) => dep.own);
  const others = deps.filter((dep) => !dep.own);
  const missing = ours.filter((dep) => dep.code.status === 'none').length;

  const pick = async (key) => {
    const folder = await backend.source.pickFolder();
    if (folder) {
      await backend.source.setModulePath(profileId, repo.id, key, folder);
      onRefresh();
    }
  };
  const clear = async (key) => {
    await backend.source.setModulePath(profileId, repo.id, key, null);
    onRefresh();
  };

  return (
    <div className={styles.deps}>
      <button type="button" className={styles.depsToggle} aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <IconChevronRight size={14} className={open ? styles.depsOpen : ''} />
        <span>{t('settingsDepTitle')}</span>
        <span className={styles.depCount}>{deps.length}</span>
        {missing > 0 && <span className={styles.depMissing}>{t('settingsDepMissing', {count: missing})}</span>}
      </button>
      {open && (
        <div className={styles.depsPanel}>
          {DEPENDENCY_KINDS.map((kind) => {
            const ofKind = ours.filter((dep) => dep.kind === kind);
            return ofKind.length ? (
              <DependencyGroup key={kind} kind={kind} deps={ofKind} onPick={pick} onClear={clear} />
            ) : null;
          })}
          {others.length > 0 && (
            <div className={styles.depGroup}>
              <Tooltip title={t('settingsDepOthersHint')} placement="topLeft">
                <button
                  type="button"
                  className={`${styles.depGroupHead} ${styles.depOthers}`}
                  aria-expanded={othersOpen}
                  onClick={() => setOthersOpen((was) => !was)}
                >
                  <IconChevronRight size={14} className={othersOpen ? styles.depsOpen : ''} />
                  <IconWorld size={14} stroke={1.8} />
                  {t('settingsDepOthers')}
                  <span className={styles.depCount}>{others.length}</span>
                </button>
              </Tooltip>
              {othersOpen &&
                others.map((dep) => <DependencyRow key={dep.key} dep={dep} onPick={pick} onClear={clear} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DependencyList;
