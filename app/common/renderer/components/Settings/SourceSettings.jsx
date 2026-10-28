import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconBrandGit,
  IconCloudDownload,
  IconFolderOpen,
  IconGitBranch,
  IconGitPullRequest,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import {App, Button, Input, Modal, Popconfirm, Select, Spin, Tooltip, Typography} from 'antd';
import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {
  branchTone,
  changeRepo,
  newRepo,
  repoWarnings,
  setBranches,
  sinceParts,
  sourceOfRepo,
} from '../../../shared/settings/source.js';
import {setProfilePlatforms, setProfileSource} from '../../lib/settings/profiles-store.js';
import {backend} from '../../polyfills.js';
import DependencyList from './DependencyList.jsx';

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

/** «8 minutes ago» in the language of the station. */
const useAgo = () => {
  const {i18n} = useTranslation();
  return (time) => {
    const {value, unit} = sinceParts(time);
    return new Intl.RelativeTimeFormat(i18n.language, {numeric: 'auto'}).format(value, unit);
  };
};

/**
 * The branch a repository is on, coloured by what it is to the project; the
 * full warning about it is in its tooltip.
 */
const BranchTag = ({state, source, warning}) => {
  const {t} = useTranslation();
  const tone = branchTone(state, source);
  return (
    <Tooltip title={warning ? t(`settingsSourceWarn_${warning.kind}`, warning) : null}>
      <span className={`${styles.branch} ${styles[`branch_${tone}`]}`}>
        <IconGitBranch size={13} />
        {state.branch ?? t('settingsSourceDetachedShort')}
      </span>
    </Tooltip>
  );
};

/** What is not right with a repository, as short marks with the whole text on hover. */
const RepoWarnings = ({warnings}) => {
  const {t} = useTranslation();
  // the branch itself says it is not the development one
  const shown = warnings.filter((warning) => warning.kind !== 'notDev' && warning.kind !== 'detached');
  if (!shown.length) {
    return null;
  }
  return (
    <div className={styles.sourceMarks}>
      {shown.map((warning) => (
        <Tooltip
          key={`${warning.kind}-${warning.branch ?? ''}`}
          title={t(`settingsSourceWarn_${warning.kind}`, warning)}
        >
          <span className={styles.sourceMark}>
            <IconAlertTriangle size={13} />
            {t(`settingsSourceMark_${warning.kind}`, warning)}
          </span>
        </Tooltip>
      ))}
    </div>
  );
};

/** An action on a repository as an icon, its name in the tooltip. */
const RepoAction = ({icon: Icon, label, ...props}) => (
  <Tooltip title={label}>
    <Button type="text" size="small" icon={<Icon size={16} />} aria-label={label} {...props} />
  </Tooltip>
);

const RepoRow = ({profileId, repo, main, info, source, onChange, onMove, onRefresh}) => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const gitError = useGitError();
  const ago = useAgo();
  const [busy, setBusy] = useState(null);
  const [switching, setSwitching] = useState(false);

  const state = info?.state;
  const ready = !!state?.ok;
  const warnings = ready ? repoWarnings(state, source) : [];
  const branchWarning = warnings.find((warning) => warning.kind === 'notDev' || warning.kind === 'detached');
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

  // where it is and when it was fetched; the address and the whole path on hover
  let meta;
  if (!info?.path) {
    meta = <span className={styles.profileHint}>{t('settingsSourceNoFolder')}</span>;
  } else if (!state) {
    meta = <Spin size="small" />;
  } else if (!state.ok) {
    meta = <span className={styles.sourceWarn}>{t(`settingsSourceErr_${state.error}`)}</span>;
  } else {
    meta = (
      <Tooltip
        title={
          <span className={styles.sourceTip}>
            <span>{info.path}</span>
            <span>{state.remote ?? t('settingsSourceNoRemote')}</span>
          </span>
        }
        placement="bottomLeft"
      >
        <span className={styles.sourceMeta}>
          <span className={styles.mono}>{info.shown || info.path}</span>
          <span>·</span>
          <span>
            {state.lastFetch
              ? t('settingsSourceFetchedAgo', {ago: ago(state.lastFetch)})
              : t('settingsSourceNeverFetched')}
          </span>
        </span>
      </Tooltip>
    );
  }

  return (
    <div className={styles.sourceRepo}>
      <div className={styles.sourceRepoHead}>
        <span className={styles.sourceRepoIcon}>
          <IconBrandGit size={18} stroke={1.6} />
        </span>
        <div className={styles.sourceRepoTitle}>
          <span className={styles.sourceRepoNameRow}>
            <Typography.Text
              strong
              className={styles.sourceName}
              editable={{
                tooltip: t('settingsSourceRename'),
                onChange: (name) => name.trim() && name.trim() !== repo.name && onChange({name: name.trim()}),
              }}
            >
              {repo.name}
            </Typography.Text>
            {main && <span className={styles.sourceMainTag}>{t('settingsSourceMain')}</span>}
            {ready && <BranchTag state={state} source={source} warning={branchWarning} />}
          </span>
          {meta}
        </div>
        <div className={styles.sourceActions}>
          {ready && (
            <>
              <RepoAction
                icon={IconCloudDownload}
                label={t('settingsSourceFetch')}
                loading={busy === 'fetch'}
                onClick={act('fetch', () => t('settingsSourceFetchDone'))}
              />
              <RepoAction icon={IconGitBranch} label={t('settingsSourceSwitch')} onClick={() => setSwitching(true)} />
              <RepoAction
                icon={IconGitPullRequest}
                label={t('settingsSourcePull')}
                loading={busy === 'pull'}
                onClick={act('pull', () => t('settingsSourcePullDone'))}
              />
              {info.previousBranch && (
                <RepoAction
                  icon={IconArrowBackUp}
                  label={t('settingsSourceRestore', {branch: info.previousBranch})}
                  loading={busy === 'restoreBranch'}
                  onClick={act('restoreBranch', () => t('settingsSourceSwitchDone', {branch: info.previousBranch}))}
                />
              )}
              <span className={styles.sourceActionsGap} />
            </>
          )}
          {info?.path ? (
            <RepoAction icon={IconFolderOpen} label={t('settingsSourcePickFolder')} onClick={pickFolder} />
          ) : (
            <Button size="small" type="primary" icon={<IconFolderOpen size={14} />} onClick={pickFolder}>
              {t('settingsSourcePickFolder')}
            </Button>
          )}
          <Popconfirm
            title={t('settingsSourceRemoveAsk', {name: repo.name})}
            okText={t('settingsSourceRemove')}
            cancelText={t('Cancel')}
            okButtonProps={{danger: true}}
            onConfirm={() => onChange(null)}
          >
            <span>
              <RepoAction icon={IconTrash} label={t('settingsSourceRemove')} danger />
            </span>
          </Popconfirm>
        </div>
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
      <RepoWarnings warnings={warnings} />
      {ready && <DependencyList profileId={profileId} repo={repo} info={info} onRefresh={onRefresh} />}
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
 * The repositories of one platform of a project on this Mac, which the agent
 * reads: the first is the main one.
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
          main={index === 0}
          info={infos.find((info) => info.repoId === repo.id)}
          source={sourceOfRepo(source, repo)}
          onChange={(patch) => save(changeRepo(source, repo.id, patch))}
          onMove={movesFor(repo)}
          onRefresh={onRefresh}
        />
      ))}
      {!repos.length && <span className={styles.profileHint}>{t('settingsSourceEmpty')}</span>}
      <div>
        <Button size="small" type="dashed" icon={<IconPlus size={14} />} onClick={addRepo}>
          {t('settingsSourceAdd')}
        </Button>
      </div>
    </div>
  );
};
