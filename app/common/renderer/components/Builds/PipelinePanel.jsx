import {
  IconBrandAndroid,
  IconBrandApple,
  IconBrandGitlab,
  IconCircleCheck,
  IconExternalLink,
  IconPencil,
  IconPlayerPlay,
  IconRefresh,
  IconX,
} from '@tabler/icons-react';
import {Alert, Button, Checkbox, Input, Progress, Select, Spin, Switch, Tooltip} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {openBuild} from '../../actions/Builds.js';
import {openLink} from '../../polyfills.js';
import {
  addWatch,
  chooseBuild,
  editJobs,
  install,
  playJob,
  refresh,
  removeWatch,
  saveProjectJobs,
  setAutoInstall,
  setTargets,
  usePipelineWatches,
} from './pipeline-watch.js';

import styles from './PipelinePanel.module.css';

const shortProject = (project) => project.split('/').slice(-2).join('/');

/**
 * The choice of jobs a project's builds come from, made once per project.
 */
const JobsChoice = ({watch, onSave}) => {
  const {t} = useTranslation();
  const [names, setNames] = useState(watch.suggested ?? []);
  const all = [...new Map((watch.jobs ?? []).map((job) => [job.name, job])).values()];
  return (
    <div className={styles.choice}>
      <div className={styles.choiceText}>
        {t('buildsPipelineChooseJobs', {project: shortProject(watch.link.project)})}
      </div>
      <Checkbox.Group
        className={styles.jobList}
        value={names}
        onChange={setNames}
        options={all.map((job) => ({
          value: job.name,
          label: (
            <span className={styles.jobOption}>
              <span className="vi-mono">{job.name}</span>
              <span className={styles.dim}>
                {job.stage}
                {job.downstream ? ` · ${t('buildsPipelineDownstream')}` : ''} ·{' '}
                {t(`buildsJobStatus_${job.status}`, {defaultValue: job.status})}
              </span>
            </span>
          ),
        }))}
      />
      <Button type="primary" size="small" disabled={!names.length} onClick={() => onSave(names)}>
        {t('buildsPipelineSaveJobs')}
      </Button>
    </div>
  );
};

/**
 * Where one pipeline is, from waiting for its job to the build installed on
 * the devices it was sent to.
 */
const WatchCard = ({watch, jobNames}) => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const devices = useSelector((state) => state.workstation.devices);
  const job = watch.artifactJob;
  const deviceOptions = devices
    .filter((device) => device.state === 'running' || watch.targets.includes(device.id))
    .map((device) => ({value: device.id, label: device.name}));

  let body;
  switch (watch.status) {
    case 'loading':
      body = (
        <span className={styles.state}>
          <Spin size="small" /> {t('buildsPipelineLoading')}
        </span>
      );
      break;
    case 'configure':
      body = <JobsChoice watch={watch} onSave={(names) => saveProjectJobs(watch.link.project, names)} />;
      break;
    case 'waiting':
      body = (
        <span className={styles.state}>
          <Spin size="small" />
          {t('buildsPipelineWaiting', {
            job: job?.name,
            status: t(`buildsJobStatus_${job?.status}`, {defaultValue: job?.status}),
          })}
        </span>
      );
      break;
    case 'manual':
      body = (
        <div className={styles.stateRow}>
          <span>{t('buildsPipelineManual', {job: job?.name})}</span>
          <Button size="small" type="primary" icon={<IconPlayerPlay size={14} />} onClick={() => playJob(watch.id)}>
            {t('buildsPipelinePlay')}
          </Button>
        </div>
      );
      break;
    case 'downloading':
      body = (
        <div className={styles.progress}>
          <span>{t('buildsPipelineDownloading', {job: job?.name})}</span>
          <Progress
            size="small"
            percent={
              watch.progress?.total ? Math.round((watch.progress.received / watch.progress.total) * 100) : undefined
            }
            status="active"
          />
        </div>
      );
      break;
    case 'extracting':
      body = (
        <span className={styles.state}>
          <Spin size="small" /> {t('buildsPipelineExtracting')}
        </span>
      );
      break;
    case 'choose':
      body = (
        <div className={styles.choice}>
          <div className={styles.choiceText}>{t('buildsPipelineChooseBuild')}</div>
          {watch.candidates.map((candidate) => (
            <Button
              key={candidate.entry}
              size="small"
              className="vi-mono"
              onClick={() => chooseBuild(watch.id, candidate)}
            >
              {candidate.name}
            </Button>
          ))}
        </div>
      );
      break;
    case 'noJobs':
      body = <Alert type="warning" showIcon title={t('buildsPipelineNoJobs')} />;
      break;
    case 'noArtifacts':
      body = <Alert type="warning" showIcon title={t('buildsPipelineNoArtifacts', {job: job?.name})} />;
      break;
    case 'failed':
      body = (
        <Alert
          type="error"
          showIcon
          title={
            job && !watch.error
              ? t('buildsPipelineJobFailed', {job: job.name})
              : t(`buildsPipelineError_${watch.errorCode}`, {defaultValue: watch.error})
          }
          action={
            ['notSetUp', 'otherSite'].includes(watch.errorCode) ? (
              <Button size="small" onClick={() => navigate('/settings')}>
                {t('buildsPipelineSetUpGitlab')}
              </Button>
            ) : null
          }
        />
      );
      break;
    case 'retry':
      body = <Alert type="warning" showIcon title={t('buildsPipelineRetry', {error: watch.error})} />;
      break;
    default:
      body = null;
  }

  const build = watch.build;

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

      {body}

      {build && (
        <div className={styles.build}>
          {build.platform === 'ios' ? <IconBrandApple size={18} /> : <IconBrandAndroid size={18} />}
          <span className="vi-mono">{build.appId}</span>
          <span className={styles.dim}>
            {build.version} {build.build ? `(${build.build})` : ''}
          </span>
          <Button
            size="small"
            type="link"
            onClick={() =>
              dispatch(
                openBuild(watch.file, {kind: 'gitlab', jobId: job?.id, job: job?.name, ref: watch.pipeline?.ref}),
              )
            }
          >
            {t('buildsPipelineAnalyze')}
          </Button>
        </div>
      )}

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
        {build && (
          <Button
            size="small"
            type={watch.status === 'installed' ? 'default' : 'primary'}
            loading={watch.status === 'installing'}
            disabled={!watch.targets.length}
            onClick={() => install(watch.id)}
          >
            {watch.status === 'installed' ? t('buildsPipelineInstallAgain') : t('buildsPipelineInstall')}
          </Button>
        )}
      </div>

      {Object.keys(watch.installs ?? {}).length > 0 && (
        <ul className={styles.installs}>
          {Object.entries(watch.installs).map(([deviceId, result]) => {
            const name = devices.find((device) => device.id === deviceId)?.name ?? deviceId;
            return (
              <li key={deviceId} className={styles.install}>
                {result.status === 'done' ? (
                  <IconCircleCheck size={15} className={styles.ok} />
                ) : result.status === 'installing' ? (
                  <Spin size="small" />
                ) : (
                  <span className="vi-dot vi-tone-danger" />
                )}
                <span>{name}</span>
                <span className={styles.dim}>
                  {t(`buildsPipelineInstall_${result.status}`, {
                    reason: result.reason ? t(`buildsInstallFail_${result.reason}`, {defaultValue: result.error}) : '',
                  })}
                </span>
                {result.reason === 'signatureMismatch' && (
                  <Button size="small" danger onClick={() => install(watch.id, {deviceId, replace: true})}>
                    {t('buildsPipelineReplace')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {watch.status !== 'configure' && (
        <div className={styles.foot}>
          <span className={styles.dim}>
            {t('buildsPipelineJobsFrom')} <span className="vi-mono">{(jobNames ?? []).join(', ') || '—'}</span>
          </span>
          <Button size="small" type="link" icon={<IconPencil size={12} />} onClick={() => editJobs(watch.id)}>
            {t('buildsPipelineEditJobs')}
          </Button>
        </div>
      )}
    </section>
  );
};

/**
 * Builds from GitLab by link: paste a pipeline (or job) of any project, say
 * where its build goes, and it is installed there when the job is done.
 */
const PipelinePanel = () => {
  const {t} = useTranslation();
  const {watches, jobs} = usePipelineWatches();
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
        <WatchCard key={watch.id} watch={watch} jobNames={jobs[watch.link.project]?.jobs} />
      ))}
    </section>
  );
};

export default PipelinePanel;
