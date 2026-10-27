import {
  IconArrowBackUp,
  IconCloudDownload,
  IconFolderOpen,
  IconGitBranch,
  IconGitPullRequest,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import {App, Button, Input, Modal, Popconfirm, Select, Spin, Tag} from 'antd';
import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {newRepo, REPO_ROLES, repoWarnings} from '../../../shared/settings/source.js';
import {setProfileSource} from '../../lib/settings/profiles-store.js';
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

const RepoState = ({info, source}) => {
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
        <div className={styles.sourceModules}>
          <span>{t('settingsSourceSubmodules')}</span>
          {state.submodules.map((module) => (
            <span key={module.path} className={styles.profileHint}>
              <span className={styles.mono}>{module.path}</span>
              {!module.initialized && ` — ${t('settingsSourceSubmoduleOff')}`}
            </span>
          ))}
        </div>
      )}
    </>
  );
};

const RepoRow = ({profileId, repo, main, info, source, onChange, onRefresh}) => {
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
          onBlur={() => name.trim() && name.trim() !== repo.name && onChange({...repo, name: name.trim()})}
          className={styles.sourceName}
          aria-label={t('settingsSourceName')}
        />
        <Select
          value={repo.role}
          onChange={(role) => onChange({...repo, role})}
          options={REPO_ROLES.map((role) => ({value: role, label: t(`settingsSourceRole_${role}`)}))}
          className={styles.sourceRole}
          aria-label={t('settingsSourceRole')}
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
      <div className={styles.sourceFolder}>
        <span className={styles.mono}>{info?.path ?? ''}</span>
        <Button size="small" icon={<IconFolderOpen size={14} />} onClick={pickFolder}>
          {t('settingsSourcePickFolder')}
        </Button>
      </div>
      <RepoState info={info} source={source} />
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

/**
 * The code of a project: the repositories on this Mac the agent reads, their
 * submodules, and the branches the team develops and releases from.
 */
const SourceSettings = ({profile}) => {
  const {t} = useTranslation();
  const source = profile.source;
  const [infos, setInfos] = useState([]);
  // the state is read again when the repositories or the branches change
  const key = JSON.stringify(source);

  const refresh = useCallback(async () => {
    if (backend?.source) {
      setInfos(await backend.source.inspect(profile.id));
    }
  }, [profile.id]);
  useEffect(() => {
    refresh();
  }, [refresh, key]);

  if (!backend?.source) {
    return null;
  }
  const save = (next) => setProfileSource(profile.id, {...source, ...next});
  const changeRepo = (index) => (repo) =>
    save({
      repos: repo
        ? source.repos.map((one, at) => (at === index ? repo : one))
        : source.repos.filter((_, at) => at !== index),
    });

  const addRepo = async () => {
    const folder = await backend.source.pickFolder();
    if (!folder) {
      return;
    }
    const repo = newRepo(source, folder);
    await save({repos: [...source.repos, repo]});
    await backend.source.setPath(profile.id, repo.id, folder);
    refresh();
  };

  return (
    <div className={`${styles.profileApps} ${styles.source}`}>
      <span>{t('settingsSourceTitle')}</span>
      <div className={styles.sourceBranches}>
        <BranchField
          label={t('settingsSourceDevBranch')}
          value={source.devBranch}
          onSave={(devBranch) => save({devBranch})}
        />
        <BranchField
          label={t('settingsSourceReleaseBranch')}
          value={source.releaseBranch}
          onSave={(releaseBranch) => save({releaseBranch})}
        />
      </div>
      {source.repos.map((repo, index) => (
        <RepoRow
          key={repo.id}
          profileId={profile.id}
          repo={repo}
          main={index === 0}
          info={infos.find((info) => info.repoId === repo.id)}
          source={source}
          onChange={changeRepo(index)}
          onRefresh={refresh}
        />
      ))}
      {!source.repos.length && <span className={styles.profileHint}>{t('settingsSourceEmpty')}</span>}
      <div>
        <Button size="small" icon={<IconPlus size={14} />} onClick={addRepo}>
          {t('settingsSourceAdd')}
        </Button>
      </div>
      <span className={styles.profileHint}>{t('settingsSourceHint')}</span>
    </div>
  );
};

export default SourceSettings;
