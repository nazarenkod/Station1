import {
  IconBrandAndroid,
  IconBrandApple,
  IconBrandGitlab,
  IconCircleCheck,
  IconDeviceDesktop,
  IconDeviceMobile,
  IconExternalLink,
  IconPencil,
  IconPlayerPlay,
  IconRefresh,
  IconX,
} from '@tabler/icons-react';
import {Alert, Button, Input, Progress, Select, Spin, Switch, Tooltip} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {likelyArtifactJobs} from '../../../shared/builds/pipelines.js';
import {openBuild} from '../../actions/Builds.js';
import {openLink} from '../../polyfills.js';
import BuildRuleEditor, {emptyRule} from './BuildRuleEditor.jsx';
import {
  addWatch,
  chooseBuild,
  install,
  playJob,
  refresh,
  removeWatch,
  saveBuildSources,
  setAutoInstall,
  setTargets,
  targetsOf,
  usePipelineWatches,
} from './pipeline-watch.js';

import styles from './PipelinePanel.module.css';

const shortProject = (project) => project.split('/').slice(-2).join('/');
const KIND_ICON = {virtual: IconDeviceDesktop, real: IconDeviceMobile};

/**
 * The rule for a project met for the first time, written right on the card.
 */
const FirstRule = ({watch, rules}) => {
  const {t} = useTranslation();
  const navigate = useNavigate();
  const [rule, setRule] = useState(() => ({
    ...emptyRule(watch.link.project),
    virtual: {jobs: watch.suggested ?? likelyArtifactJobs(watch.jobs ?? []), file: ''},
  }));
  const jobNames = [...new Set((watch.jobs ?? []).map((job) => job.name))];
  return (
    <div className={styles.choice}>
      <div className={styles.choiceText}>{t('buildsPipelineNoRule', {project: shortProject(watch.link.project)})}</div>
      <BuildRuleEditor rule={rule} onChange={setRule} jobNames={jobNames} />
      <div className={styles.stateRow}>
        <Button
          type="primary"
          size="small"
          disabled={!rule.project.trim() || !(rule.virtual.jobs.length || rule.real.jobs.length)}
          onClick={() => saveBuildSources([...rules, rule])}
        >
          {t('buildsPipelineSaveRule')}
        </Button>
        <Button size="small" type="link" onClick={() => navigate('/settings', {state: {section: 'builds'}})}>
          {t('buildsPipelineAllRules')}
        </Button>
      </div>
    </div>
  );
};

/**
 * Where the build for one kind of device is: its job, its download, the
 * build itself and its installs.
 */
const KindRow = ({watch, kind, build}) => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const devices = useSelector((state) => state.workstation.devices);
  const Icon = KIND_ICON[kind];
  const job = build.job;
  const jobStatus = job ? t(`buildsJobStatus_${job.status}`, {defaultValue: job.status}) : '';
  const targets = targetsOf(watch, kind);

  let state;
  switch (build.status) {
    case 'waiting':
      state = (
        <span className={styles.state}>
          <Spin size="small" /> {t('buildsPipelineWaiting', {job: job?.name, status: jobStatus})}
        </span>
      );
      break;
    case 'missing':
      state = (
        <span className={styles.state}>
          <Spin size="small" /> {t('buildsPipelineMissing')}
        </span>
      );
      break;
    case 'manual':
      state = (
        <div className={styles.stateRow}>
          <span>{t('buildsPipelineManual', {job: job?.name})}</span>
          <Button
            size="small"
            type="primary"
            icon={<IconPlayerPlay size={14} />}
            onClick={() => playJob(watch.id, kind)}
          >
            {t('buildsPipelinePlay')}
          </Button>
        </div>
      );
      break;
    case 'downloading':
      state = (
        <div className={styles.progress}>
          <span>{t('buildsPipelineDownloading', {job: job?.name})}</span>
          <Progress
            size="small"
            percent={
              build.progress?.total ? Math.round((build.progress.received / build.progress.total) * 100) : undefined
            }
            status="active"
          />
        </div>
      );
      break;
    case 'extracting':
      state = (
        <span className={styles.state}>
          <Spin size="small" /> {t('buildsPipelineExtracting')}
        </span>
      );
      break;
    case 'choose':
      state = (
        <div className={styles.choice}>
          <div className={styles.choiceText}>{t('buildsPipelineChooseBuild')}</div>
          {build.candidates.map((candidate) => (
            <Button
              key={candidate.entry}
              size="small"
              className="vi-mono"
              onClick={() => chooseBuild(watch.id, kind, candidate)}
            >
              {candidate.name}
            </Button>
          ))}
        </div>
      );
      break;
    case 'noJobs':
      state = <span className={styles.warn}>{t('buildsPipelineNoJobs')}</span>;
      break;
    case 'noArtifacts':
      state = <span className={styles.warn}>{t('buildsPipelineNoArtifacts', {job: job?.name})}</span>;
      break;
    case 'failed':
      state = <span className={styles.bad}>{build.error ?? t('buildsPipelineJobFailed', {job: job?.name})}</span>;
      break;
    case 'retry':
      state = <span className={styles.warn}>{t('buildsPipelineRetry', {error: build.error})}</span>;
      break;
    default:
      state = null;
  }

  return (
    <div className={styles.kind}>
      <div className={styles.kindHead}>
        <Icon size={16} stroke={1.7} />
        <span className={styles.kindTitle}>{t(`buildRuleKind_${kind}`)}</span>
        {job && <span className={`vi-mono ${styles.dim}`}>{job.name}</span>}
      </div>
      {state}
      {build.build && (
        <div className={styles.build}>
          {build.build.platform === 'ios' ? <IconBrandApple size={18} /> : <IconBrandAndroid size={18} />}
          <span className="vi-mono">{build.build.appId}</span>
          <span className={styles.dim}>
            {build.build.version} {build.build.build ? `(${build.build.build})` : ''}
          </span>
          <Button
            size="small"
            type="link"
            onClick={() =>
              dispatch(
                openBuild(build.file, {kind: 'gitlab', jobId: job?.id, job: job?.name, ref: watch.pipeline?.ref}),
              )
            }
          >
            {t('buildsPipelineAnalyze')}
          </Button>
          <span className={styles.grow} />
          <Button
            size="small"
            type={build.status === 'installed' ? 'default' : 'primary'}
            loading={build.status === 'installing'}
            disabled={!targets.length}
            onClick={() => install(watch.id, {kind})}
          >
            {build.status === 'installed' ? t('buildsPipelineInstallAgain') : t('buildsPipelineInstall')}
          </Button>
        </div>
      )}
      {Object.keys(build.installs ?? {}).length > 0 && (
        <ul className={styles.installs}>
          {Object.entries(build.installs).map(([deviceId, result]) => (
            <li key={deviceId} className={styles.install}>
              {result.status === 'done' ? (
                <IconCircleCheck size={15} className={styles.ok} />
              ) : result.status === 'installing' ? (
                <Spin size="small" />
              ) : (
                <span className="vi-dot vi-tone-danger" />
              )}
              <span>{devices.find((device) => device.id === deviceId)?.name ?? deviceId}</span>
              <span className={styles.dim}>
                {t(`buildsPipelineInstall_${result.status}`, {
                  reason: result.reason ? t(`buildsInstallFail_${result.reason}`, {defaultValue: result.error}) : '',
                })}
              </span>
              {result.reason === 'signatureMismatch' && (
                <Button size="small" danger onClick={() => install(watch.id, {kind, deviceId, replace: true})}>
                  {t('buildsPipelineReplace')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/**
 * One pipeline followed: where its builds are, for each kind of device they
 * go to, and the devices they go to.
 */
const WatchCard = ({watch, rules}) => {
  const {t} = useTranslation();
  const navigate = useNavigate();
  const devices = useSelector((state) => state.workstation.devices);
  const deviceOptions = devices
    .filter((device) => device.state === 'running' || watch.targets.includes(device.id))
    .map((device) => ({value: device.id, label: device.name}));
  const kinds = ['virtual', 'real'].filter((kind) => watch.builds[kind]);

  let body = null;
  if (watch.status === 'loading') {
    body = (
      <span className={styles.state}>
        <Spin size="small" /> {t('buildsPipelineLoading')}
      </span>
    );
  } else if (watch.status === 'configure') {
    body = <FirstRule watch={watch} rules={rules} />;
  } else if (watch.status === 'retry') {
    body = <Alert type="warning" showIcon title={t('buildsPipelineRetry', {error: watch.error})} />;
  } else if (watch.status === 'failed') {
    body = (
      <Alert
        type="error"
        showIcon
        title={t(`buildsPipelineError_${watch.errorCode}`, {defaultValue: watch.error})}
        action={
          ['notSetUp', 'otherSite'].includes(watch.errorCode) ? (
            <Button size="small" onClick={() => navigate('/settings')}>
              {t('buildsPipelineSetUpGitlab')}
            </Button>
          ) : null
        }
      />
    );
  } else if (!kinds.length) {
    body = <span className={styles.dim}>{t('buildsPipelinePickDevices')}</span>;
  }

  return (
    <section className={styles.card} aria-label={`#${watch.pipeline?.id ?? ''}`}>
      <div className={styles.cardHead}>
        <span className={styles.title}>
          <span className="vi-mono">{shortProject(watch.link.project)}</span>
          <span className={styles.dim}>
            #{watch.pipeline?.id ?? watch.link.pipelineId ?? watch.link.jobId}
            {watch.pipeline?.ref ? ` · ${watch.pipeline.ref}` : ''}
          </span>
        </span>
        {watch.pipeline && (
          <span className={`${styles.pill} ${styles[`pill_${watch.pipeline.status}`] ?? ''}`}>
            {t(`buildsJobStatus_${watch.pipeline.status}`, {defaultValue: watch.pipeline.status})}
          </span>
        )}
        <Tooltip title={t('buildsPipelineRefresh')}>
          <Button size="small" type="text" icon={<IconRefresh size={14} />} onClick={() => refresh(watch.id)} />
        </Tooltip>
        <Tooltip title={t('buildsPipelineOpen')}>
          <Button size="small" type="text" icon={<IconExternalLink size={14} />} onClick={() => openLink(watch.url)} />
        </Tooltip>
        <Tooltip title={t('buildsPipelineRemove')}>
          <Button size="small" type="text" icon={<IconX size={14} />} onClick={() => removeWatch(watch.id)} />
        </Tooltip>
      </div>

      <div className={styles.targets}>
        <span className={styles.label}>{t('buildsPipelineTargets')}</span>
        <Select
          mode="multiple"
          size="small"
          className={styles.targetSelect}
          value={watch.targets}
          onChange={(targets) => setTargets(watch.id, targets)}
          options={deviceOptions}
          placeholder={t('buildsPipelineTargetsNone')}
        />
        <label className={styles.auto}>
          <Switch size="small" checked={watch.autoInstall} onChange={(value) => setAutoInstall(watch.id, value)} />
          {t('buildsPipelineAuto')}
        </label>
      </div>

      {body}
      {watch.status === 'tracking' &&
        kinds.map((kind) => <KindRow key={kind} watch={watch} kind={kind} build={watch.builds[kind]} />)}

      {watch.rule && (
        <div className={styles.foot}>
          <span className={styles.dim}>
            {t('buildsPipelineRule')} <span className="vi-mono">{watch.rule}</span>
          </span>
          <Button
            size="small"
            type="link"
            icon={<IconPencil size={12} />}
            onClick={() => navigate('/settings', {state: {section: 'builds', project: watch.rule}})}
          >
            {t('buildsPipelineEditJobs')}
          </Button>
        </div>
      )}
    </section>
  );
};

/**
 * Builds from GitLab by link: paste a pipeline (or job) of any project, say
 * where its builds go, and they are installed there when their jobs are done.
 */
const PipelinePanel = () => {
  const {t} = useTranslation();
  const {watches, sources} = usePipelineWatches();
  const [text, setText] = useState('');
  const [error, setError] = useState(null);

  const follow = (value) => {
    if (!value.trim()) {
      return;
    }
    const result = addWatch(value);
    setError(result.error ?? null);
    if (!result.error) {
      setText('');
    }
  };

  return (
    <section className={styles.panel} aria-labelledby="pipeline-title">
      <div className={styles.panelHead}>
        <IconBrandGitlab size={18} stroke={1.7} className={styles.gitlab} />
        <h2 id="pipeline-title" className={styles.panelTitle}>
          {t('buildsPipelineTitle')}
        </h2>
      </div>
      <Input.Search
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onSearch={follow}
        placeholder={t('buildsPipelinePlaceholder')}
        enterButton={t('buildsPipelineFollow')}
        status={error ? 'error' : undefined}
        allowClear
      />
      {error && <span className={styles.error}>{t(error)}</span>}
      {watches.map((watch) => (
        <WatchCard key={watch.id} watch={watch} rules={sources.rules} />
      ))}
    </section>
  );
};

export default PipelinePanel;
