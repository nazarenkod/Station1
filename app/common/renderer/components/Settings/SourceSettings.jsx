import {
  IconArrowBackUp,
  IconCloudDownload,
  IconFolderOpen,
  IconGitBranch,
  IconGitPullRequest,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import {App, Button, Input, Modal, Popconfirm, Select, Spin, Tag, Tooltip} from 'antd';
import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {
  changeRepo,
  moduleTree,
  newRepo,
  repoWarnings,
  setBranches,
  sourceOfRepo,
} from '../../../shared/settings/source.js';
import {setProfilePlatforms, setProfileSource} from '../../lib/settings/profiles-store.js';
import {backend} from '../../polyfills.js';

import styles from './SettingsPage.module.css';

const SHOWN_CHANGES = 20;

// what git said goes under the explanation, as the rules of the station want
const useGitError = () => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  return (result) =>
    message.error({
      content: (
        <span className={styles.sourceError}>
          {t(`settingsSourceErr_${result.error}`, {defaultValue: t('settingsSourceErr_switch')})}
          {result.detail && <code className={styles.sourceDetail}>{result.detail}</code>}
        </span>
      ),
      duration: 8,
    });
};

/**
 * Switching a branch: the branches of the repository and what the switch
 * would discard, so nothing goes without the person seeing it.
 */
const SwitchDialog = ({open, profileId, repo, source, onClose, onDone}) => {
  const {t} = useTranslation();
  const gitError = useGitError();
  const [branches, setBranches] = useState(null);
  const [changes, setChanges] = useState(null);
  const [branch, setBranch] = useState(source.devBranch);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setBranch(source.devBranch);
    setBranches(null);
    setChanges(null);
    backend.source.branches(profileId, repo.id).then((result) => setBranches(result.ok ? result.branches : []));
    backend.source.preview(profileId, repo.id).then((result) => setChanges(result.ok ? result.changes : []));
  }, [open, profileId, repo.id, source.devBranch]);

  const run = async () => {
    setWorking(true);
    const result = await backend.source.switchBranch(profileId, repo.id, branch);
    setWorking(false);
    if (!result.ok) {
      gitError(result);
      return;
    }
    if (result.warning) {
      gitError(result.warning);
    }
    onDone(branch);
  };

  const loading = branches === null || changes === null;
  return (
    <Modal
      open={open}
      title={t('settingsSourceSwitchTitle', {name: repo.name})}
      okText={changes?.length ? t('settingsSourceSwitchDiscardOk') : t('settingsSourceSwitchOk')}
      okButtonProps={{danger: !!changes?.length, disabled: loading || !branch, loading: working}}
      cancelText={t('Cancel')}
      onOk={run}
      onCancel={onClose}
      destroyOnHidden
    >
      {loading ? (
        <Spin />
      ) : (
        <div className={styles.sourceSwitch}>
          <Select
            showSearch
            value={branch}
            onChange={setBranch}
            options={branches.map((name) => ({value: name, label: name}))}
            className={styles.mono}
            aria-label={t('settingsSourceSwitchBranch')}
          />
          {changes.length ? (
            <>
              <span className={styles.sourceWarn}>{t('settingsSourceSwitchDiscard', {count: changes.length})}</span>
              <ul className={styles.sourceChanges}>
                {changes.slice(0, SHOWN_CHANGES).map((change) => (
                  <li key={`${change.repo}/${change.path}`}>
                    <span className={styles.sourceKind}>{t(`settingsSourceKind_${change.kind}`)}</span>
                    <span className={styles.mono}>
                      {change.repo === '.' ? change.path : `${change.repo}/${change.path}`}
                    </span>
                  </li>
                ))}
              </ul>
              {changes.length > SHOWN_CHANGES && (
                <span className={styles.profileHint}>
                  {t('settingsSourceSwitchMore', {count: changes.length - SHOWN_CHANGES})}
                </span>
              )}
            </>
          ) : (
            <span className={styles.profileHint}>{t('settingsSourceSwitchClean')}</span>
          )}
        </div>
      )}
    </Modal>
  );
};

/**
 * The submodules of a repository as a tree: a submodule of a submodule sits
 * under it. Each is of the platform of its repository and may come from a
 * folder of its own instead of the copy inside.
 */
const ModuleTree = ({profileId, repo, info, onRefresh}) => {
  const {t} = useTranslation();
  const tree = moduleTree(info.state.submodules);
  const own = info.modules ?? {};

  const pickFolder = async (modulePath) => {
    const folder = await backend.source.pickFolder();
    if (folder) {
      await backend.source.setModulePath(profileId, repo.id, modulePath, folder);
      onRefresh();
    }
  };
  const clearFolder = async (modulePath) => {
    await backend.source.setModulePath(profileId, repo.id, modulePath, null);
    onRefresh();
  };

  return (
    <div className={styles.sourceModules}>
      <span>{t('settingsSourceSubmodules')}</span>
      {tree.map((module) => {
        const name = module.parent ? module.path.slice(module.parent.length + 1) : module.path;
        return (
          <div
            key={module.path}
            className={`${styles.sourceModule} ${module.depth ? styles.sourceModuleNested : ''}`}
            style={{'--depth': module.depth}}
          >
            <span className={`${styles.mono} ${styles.sourceModuleName}`} title={module.url || module.path}>
              {name}
            </span>
            {!module.initialized && !own[module.path] && (
              <Tag className={styles.sourceModuleOff}>{t('settingsSourceSubmoduleOff')}</Tag>
            )}
            <span className={styles.spacer} />
            {own[module.path] ? (
              <Tag
                closable
                onClose={(e) => {
                  e.preventDefault();
                  clearFolder(module.path);
                }}
                title={own[module.path]}
                className={styles.mono}
              >
                {own[module.path].split('/').slice(-2).join('/')}
              </Tag>
            ) : (
              <Tooltip title={t('settingsSourceModuleFolderHint')}>
                <Button
                  size="small"
                  type="text"
                  icon={<IconFolderOpen size={14} />}
                  onClick={() => pickFolder(module.path)}
                >
                  {t('settingsSourceModuleFolder')}
                </Button>
              </Tooltip>
            )}
          </div>
        );
      })}
    </div>
  );
};

const RepoState = ({profileId, repo, info, source, onRefresh}) => {
  const {t} = useTranslation();
  if (!info?.path) {
    return <span className={styles.profileHint}>{t('settingsSourceNoFolder')}</span>;
  }
  const state = info.state;
  if (!state) {
    return <Spin size="small" />;
  }
  if (!state.ok) {
    return <span className={styles.sourceWarn}>{t(`settingsSourceErr_${state.error}`)}</span>;
  }
  const facts = [
    state.branch ?? t('settingsSourceDetachedShort'),
    state.remote ?? t('settingsSourceNoRemote'),
    state.lastFetch
      ? t('settingsSourceFetched', {time: new Date(state.lastFetch).toLocaleString()})
      : t('settingsSourceNeverFetched'),
  ];
  return (
    <>
      <span className={styles.profileHint}>
        <IconGitBranch size={14} className={styles.sourceIcon} />
        {facts.join(' · ')}
      </span>
      {repoWarnings(state, source).map((warning) => (
        <span key={`${warning.kind}-${warning.branch ?? ''}`} className={styles.sourceWarn}>
          {t(`settingsSourceWarn_${warning.kind}`, warning)}
        </span>
      ))}
      {state.submodules.length > 0 && (
        <ModuleTree profileId={profileId} repo={repo} info={info} onRefresh={onRefresh} />
      )}
    </>
  );
};

const RepoRow = ({profileId, repo, main, info, source, onChange, onMove, onRefresh}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const gitError = useGitError();
  const [name, setName] = useState(repo.name);
  const [busy, setBusy] = useState(null);
  const [switching, setSwitching] = useState(false);
  useEffect(() => setName(repo.name), [repo.name]);

  const ready = !!info?.state?.ok;
  const act = (action, done) => async () => {
    setBusy(action);
    const result = await backend.source[action](profileId, repo.id);
    setBusy(null);
    if (result.ok) {
      message.success(done(result));
    } else {
      gitError(result);
    }
    onRefresh();
  };

  const pickFolder = async () => {
    const folder = await backend.source.pickFolder();
    if (folder) {
      await backend.source.setPath(profileId, repo.id, folder);
      onRefresh();
    }
  };

  return (
    <div className={styles.sourceRepo}>
      <div className={styles.sourceRepoHead}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== repo.name && onChange({name: name.trim()})}
          className={styles.sourceName}
          aria-label={t('settingsSourceName')}
        />
        {main && <Tag>{t('settingsSourceMain')}</Tag>}
        <Popconfirm
          title={t('settingsSourceRemoveAsk', {name: repo.name})}
          okText={t('settingsSourceRemove')}
          cancelText={t('Cancel')}
          okButtonProps={{danger: true}}
          onConfirm={() => onChange(null)}
        >
          <Button type="text" danger icon={<IconTrash size={16} />} aria-label={t('settingsSourceRemove')} />
        </Popconfirm>
      </div>
      {repo.guessed && (
        <div className={styles.sourceGuessed}>
          <span>{t('settingsSourceGuessed', {platform: t(`settingsPlatform_${repo.platform}`)})}</span>
          <Button size="small" onClick={() => onChange({confirm: true})}>
            {t('settingsSourceGuessedKeep')}
          </Button>
          {onMove.map((move) => (
            <Button key={move.key} size="small" onClick={() => move.run()}>
              {move.label}
            </Button>
          ))}
        </div>
      )}
      <div className={styles.sourceFolder}>
        <span className={styles.mono}>{info?.path ?? ''}</span>
        <Button size="small" icon={<IconFolderOpen size={14} />} onClick={pickFolder}>
          {t('settingsSourcePickFolder')}
        </Button>
      </div>
      <RepoState profileId={profileId} repo={repo} info={info} source={source} onRefresh={onRefresh} />
      {ready && (
        <div className={styles.sourceActions}>
          <Button
            size="small"
            icon={<IconCloudDownload size={14} />}
            loading={busy === 'fetch'}
            onClick={act('fetch', () => t('settingsSourceFetchDone'))}
          >
            {t('settingsSourceFetch')}
          </Button>
          <Button size="small" icon={<IconGitBranch size={14} />} onClick={() => setSwitching(true)}>
            {t('settingsSourceSwitch')}
          </Button>
          <Button
            size="small"
            icon={<IconGitPullRequest size={14} />}
            loading={busy === 'pull'}
            onClick={act('pull', () => t('settingsSourcePullDone'))}
          >
            {t('settingsSourcePull')}
          </Button>
          {info.previousBranch && (
            <Button
              size="small"
              icon={<IconArrowBackUp size={14} />}
              loading={busy === 'restoreBranch'}
              onClick={act('restoreBranch', () => t('settingsSourceSwitchDone', {branch: info.previousBranch}))}
            >
              {t('settingsSourceRestore', {branch: info.previousBranch})}
            </Button>
          )}
        </div>
      )}
      <SwitchDialog
        open={switching}
        profileId={profileId}
        repo={repo}
        source={source}
        onClose={() => setSwitching(false)}
        onDone={(branch) => {
          setSwitching(false);
          message.success(t('settingsSourceSwitchDone', {branch}));
          onRefresh();
        }}
      />
    </div>
  );
};

const BranchField = ({label, value, onSave}) => {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className={styles.sourceBranch}>
      <span className={styles.profileAppPlatform}>{label}</span>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== value && onSave(text.trim())}
        onPressEnter={() => text.trim() !== value && onSave(text.trim())}
        className={styles.mono}
      />
    </label>
  );
};

/** The state of the profile's repositories on this Mac, read again when its code changes. */
export function useSourceInfos(profile) {
  const [infos, setInfos] = useState([]);
  const key = JSON.stringify(profile.source);
  const refresh = useCallback(async () => {
    if (backend?.source) {
      setInfos(await backend.source.inspect(profile.id));
    }
  }, [profile.id]);
  useEffect(() => {
    refresh();
  }, [refresh, key]);
  return {infos, refresh};
}

/** The branches the team of a platform develops and releases from. */
export const BranchFields = ({profile, platform}) => {
  const {t} = useTranslation();
  const own = profile.source.branches?.[platform] ?? {};
  const save = (branches) => setProfileSource(profile.id, setBranches(profile.source, platform, branches));
  return (
    <div className={styles.sourceBranches}>
      <BranchField label={t('settingsSourceDevBranch')} value={own.dev ?? ''} onSave={(dev) => save({dev})} />
      <BranchField
        label={t('settingsSourceReleaseBranch')}
        value={own.release ?? ''}
        onSave={(release) => save({release})}
      />
    </div>
  );
};

/**
 * The repositories of one platform of a project (or of its shared code) on
 * this Mac, which the agent reads: the first is the main one.
 */
export const RepoList = ({profile, platform, infos, onRefresh}) => {
  const {t} = useTranslation();
  if (!backend?.source) {
    return null;
  }
  const source = profile.source;
  const repos = source.repos.filter((repo) => repo.platform === platform);
  const save = (next) => setProfileSource(profile.id, next);

  const addRepo = async () => {
    const folder = await backend.source.pickFolder();
    if (!folder) {
      return;
    }
    const repo = newRepo(folder, platform);
    await save({...source, repos: [...source.repos, repo]});
    await backend.source.setPath(profile.id, repo.id, folder);
    onRefresh();
  };

  // where a repository the station placed itself can go instead: the other platform, or one code for both
  const movesFor = (repo) => {
    if (!repo.guessed || profile.platforms.includes('multi')) {
      return [];
    }
    const other = repo.platform === 'android' ? 'ios' : 'android';
    return [
      {
        key: other,
        label: t('settingsSourceMoveTo', {platform: t(`settingsPlatform_${other}`)}),
        run: async () => {
          if (!profile.platforms.includes(other)) {
            await setProfilePlatforms(profile.id, [...profile.platforms, other]);
          }
          await save(changeRepo(source, repo.id, {platform: other}));
        },
      },
      {key: 'multi', label: t('settingsPlatformMakeMulti'), run: () => setProfilePlatforms(profile.id, 'multi')},
    ];
  };

  return (
    <div className={styles.profileApps}>
      {repos.map((repo, index) => (
        <RepoRow
          key={repo.id}
          profileId={profile.id}
          repo={repo}
          main={platform !== 'shared' && index === 0}
          info={infos.find((info) => info.repoId === repo.id)}
          source={sourceOfRepo(source, repo)}
          onChange={(patch) => save(changeRepo(source, repo.id, patch))}
          onMove={movesFor(repo)}
          onRefresh={onRefresh}
        />
      ))}
      {!repos.length && (
        <span className={styles.profileHint}>
          {platform === 'shared' ? t('settingsSourceSharedEmpty') : t('settingsSourceEmpty')}
        </span>
      )}
      <div>
        <Button size="small" icon={<IconPlus size={14} />} onClick={addRepo}>
          {platform === 'shared' ? t('settingsSourceAddShared') : t('settingsSourceAdd')}
        </Button>
      </div>
    </div>
  );
};
