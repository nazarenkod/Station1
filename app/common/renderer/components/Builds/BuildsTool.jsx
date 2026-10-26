import {
  IconBrandAndroid,
  IconBrandApple,
  IconBrandGitlab,
  IconCircleCheck,
  IconDownload,
  IconFileUpload,
  IconPlugConnected,
  IconRefresh,
  IconShieldCheck,
  IconSignature,
  IconTag,
} from '@tabler/icons-react';
import {Alert, Button, Popconfirm, Progress, Skeleton, Spin} from 'antd';
import dayjs from 'dayjs';
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {compatibility} from '../../../shared/builds/compatibility.js';
import {
  fetchGitlabBuild,
  installBuild,
  loadBuildsHistory,
  loadGitlabBuilds,
  openBuild,
  pickBuild,
} from '../../actions/Builds.js';
import {activeDevice, isDeviceRunning} from '../../actions/Workstation.js';
import {backend} from '../../polyfills.js';
import {EASE_OUT, Stagger, StaggerItem} from '../AppShell/motion.jsx';
import FindingsList from '../Findings/FindingsList.jsx';

import styles from './Builds.module.css';

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) {
    return '';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 && unit ? 1 : 0)} ${units[unit]}`;
}

const versionText = (version, build) => [version, build && `(${build})`].filter(Boolean).join(' ');

const PlatformIcon = ({platform, size = 22}) =>
  platform === 'ios' ? <IconBrandApple size={size} stroke={1.6} /> : <IconBrandAndroid size={size} stroke={1.6} />;

/**
 * Where a build file goes: dropped anywhere on the page or picked.
 */
const DropZone = ({compact}) => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  return (
    <button className={`${styles.drop} ${compact ? styles.dropCompact : ''}`} onClick={() => dispatch(pickBuild())}>
      <span className={styles.dropIcon} aria-hidden="true">
        <IconFileUpload size={compact ? 18 : 30} stroke={1.5} />
      </span>
      <span className={styles.dropText}>
        <span className={styles.strong}>{compact ? t('buildsDrop') : t('buildsDropTitle')}</span>
        {!compact && <span className={styles.sub}>{t('buildsDropHint')}</span>}
      </span>
      {!compact && (
        <>
          <span className={styles.dropCta}>{t('buildsPickFile')}</span>
          <span className={styles.formats} aria-label={t('buildsFormats')}>
            <span>APK</span>
            <span>IPA</span>
            <span>.app</span>
          </span>
        </>
      )}
    </button>
  );
};

const CHECKS = [
  {key: 'version', icon: IconTag},
  {key: 'signing', icon: IconSignature},
  {key: 'manifest', icon: IconShieldCheck},
  {key: 'install', icon: IconDownload},
];

/**
 * What happens to a build once it is open, shown before there is one.
 */
const WhatWeCheck = () => {
  const {t} = useTranslation();
  return (
    <section className={styles.checks} aria-labelledby="builds-checks">
      <h2 id="builds-checks" className="vi-eyebrow">
        {t('buildsWhatWeCheck')}
      </h2>
      <ul className={styles.checkList}>
        {CHECKS.map(({key, icon: Icon}) => (
          <li key={key} className={styles.checkItem}>
            <span className={styles.checkIcon} aria-hidden="true">
              <Icon size={18} stroke={1.6} />
            </span>
            <span className={styles.strong}>{t(`buildsCheck_${key}`)}</span>
            <span className={styles.sub}>{t(`buildsCheck_${key}_text`)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};

/**
 * Installing the open build on the active device, and what to do when it fails.
 */
const InstallPanel = ({build}) => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const workstation = useSelector((state) => state.workstation);
  const install = useSelector((state) => state.builds.install);
  const device = activeDevice(workstation);

  if (!device || !isDeviceRunning(device)) {
    return <div className={styles.hint}>{t('buildsNoDevice')}</div>;
  }
  const fits = compatibility(build, device);
  const onThisDevice = install.deviceId === device.id;

  return (
    <div className={styles.install}>
      <div className={styles.installRow}>
        <Button
          type="primary"
          icon={<IconDownload size={16} />}
          disabled={!fits.ok}
          loading={install.status === 'installing'}
          onClick={() => dispatch(installBuild())}
        >
          {install.status === 'installing' ? t('buildsInstalling') : t('buildsInstallOn', {device: device.name})}
        </Button>
        <AnimatePresence>
          {install.status === 'done' && onThisDevice && (
            <motion.span
              className={styles.installed}
              initial={{opacity: 0, x: -6}}
              animate={{opacity: 1, x: 0}}
              transition={{duration: 0.3, ease: EASE_OUT}}
            >
              <IconCircleCheck size={16} />
              {t('buildsInstalled', {device: device.name})}
              <Button size="small" type="link" onClick={() => navigate('/session')}>
                {t('buildsOpenInspector')}
              </Button>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {!fits.ok && (
        <Alert type="warning" showIcon title={t(`buildsInstallFail_${fits.reason}`, {device: device.name})} />
      )}
      {install.status === 'failed' && onThisDevice && (
        <Alert
          type="error"
          showIcon
          title={t(`buildsInstallFail_${install.reason}`, {defaultValue: t('buildsInstallFail_failed')})}
          description={
            <div className={styles.failure}>
              {install.error && <code className={styles.mono}>{install.error}</code>}
              {install.reason === 'signatureMismatch' && (
                <Popconfirm
                  title={t('buildsReplaceConfirm', {app: build.appId})}
                  okText={t('buildsReplace')}
                  okButtonProps={{danger: true}}
                  onConfirm={() => dispatch(installBuild({replace: true}))}
                >
                  <Button danger size="small">
                    {t('buildsReplace')}
                  </Button>
                </Popconfirm>
              )}
              {install.reason === 'downgrade' && (
                <Button size="small" onClick={() => dispatch(installBuild({allowDowngrade: true}))}>
                  {t('buildsDowngrade')}
                </Button>
              )}
            </div>
          }
        />
      )}
    </div>
  );
};

/**
 * The open build: what app and version it is, how it is signed, and its findings.
 */
const BuildCard = () => {
  const {t} = useTranslation();
  const current = useSelector((state) => state.builds.current);

  if (current.status === 'reading') {
    return (
      <section className={styles.card}>
        <Skeleton active avatar paragraph={{rows: 3}} />
      </section>
    );
  }
  if (current.status === 'error') {
    return (
      <Alert
        type="error"
        showIcon
        title={t(`buildsReadFail_${current.code}`, {defaultValue: t('buildsReadFail')})}
        description={<code className={styles.mono}>{current.error}</code>}
      />
    );
  }
  if (current.status !== 'ready') {
    return null;
  }
  const {build, findings, source} = current;
  const facts = [
    [t('buildsVersion'), versionText(build.version, build.build) || '—'],
    [t('buildsSigning'), t(`buildsSigning_${build.signing}`)],
    [t('buildsMinOs'), build.minOs || '—'],
    build.platform === 'android'
      ? [t('buildsTargetSdk'), build.manifest.targetSdk ? `API ${build.manifest.targetSdk}` : '—']
      : [t('buildsTarget'), t(`buildsTarget_${build.target}`)],
    [t('buildsSize'), formatBytes(build.size) || '—'],
  ];

  return (
    <motion.section
      className={styles.card}
      key={build.file}
      initial={{opacity: 0, y: 10}}
      animate={{opacity: 1, y: 0}}
      transition={{duration: 0.4, ease: EASE_OUT}}
    >
      <div className={styles.buildHead}>
        <span className={`${styles.platform} ${styles[`platform_${build.platform}`]}`}>
          <PlatformIcon platform={build.platform} />
        </span>
        <div className={styles.stack}>
          <span className={styles.buildName}>{build.name}</span>
          <span className={`${styles.mono} ${styles.sub}`}>{build.appId}</span>
        </div>
        <span className={styles.format}>{build.format.toUpperCase()}</span>
      </div>
      <div className={styles.facts}>
        {facts.map(([label, value]) => (
          <div key={label} className={styles.fact}>
            <span className={styles.factLabel}>{label}</span>
            <span className={styles.factValue}>{value}</span>
          </div>
        ))}
      </div>
      <div className={`${styles.sub} ${styles.mono} ${styles.path}`}>
        {source?.kind === 'gitlab' ? `GitLab · ${source.job} · ${source.ref} · ` : ''}
        {build.fileName}
      </div>
      <InstallPanel build={build} />
      <div className={styles.findingsHead}>
        <h2 className={styles.cardTitle}>{t(build.platform === 'android' ? 'buildsManifest' : 'buildsInfoPlist')}</h2>
      </div>
      <FindingsList findings={findings} emptyText={t('buildsNoFindings')} />
    </motion.section>
  );
};

const GitLabBuilds = () => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const {gitlab, fetch} = useSelector((state) => state.builds);

  useEffect(() => {
    dispatch(loadGitlabBuilds());
  }, [dispatch]);

  let body;
  if (gitlab.status === 'off') {
    body = (
      <div className={styles.emptyLine}>
        <span className={styles.sub}>{t('buildsGitlabOff')}</span>
        <Button size="small" icon={<IconPlugConnected size={14} />} onClick={() => navigate('/settings')}>
          {t('buildsGitlabConnect')}
        </Button>
      </div>
    );
  } else if (gitlab.status === 'loading' || gitlab.status === 'idle') {
    body = <Skeleton active title={false} paragraph={{rows: 4}} />;
  } else if (gitlab.status === 'error') {
    body = <span className={styles.error}>{gitlab.error}</span>;
  } else if (!gitlab.builds.length) {
    body = <span className={styles.sub}>{t('buildsGitlabEmpty')}</span>;
  } else {
    body = gitlab.builds.map((job) => {
      const busy = fetch.jobId === job.jobId && ['downloading', 'extracting'].includes(fetch.status);
      const progress = fetch.jobId === job.jobId ? fetch.progress : null;
      return (
        <div key={job.jobId} className={styles.job}>
          <div className={styles.jobText}>
            <span className={styles.row}>
              <span className={styles.strong}>{job.name}</span>
              <span className={styles.ref}>{job.ref}</span>
            </span>
            <span className={styles.sub}>
              {[job.commit, dayjs(job.finishedAt).format('D MMM, HH:mm'), formatBytes(job.size)]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {busy && progress?.total && (
              <Progress percent={Math.round((progress.received / progress.total) * 100)} size="small" />
            )}
            {fetch.jobId === job.jobId && fetch.status === 'choose' && (
              <div className={styles.choices}>
                {fetch.candidates.map((candidate) => (
                  <Button key={candidate.entry} size="small" onClick={() => dispatch(fetchGitlabBuild(job, candidate))}>
                    {candidate.name}
                  </Button>
                ))}
              </div>
            )}
            {fetch.jobId === job.jobId && fetch.status === 'empty' && (
              <span className={styles.sub}>{t('buildsGitlabNoBuild')}</span>
            )}
            {fetch.jobId === job.jobId && fetch.status === 'failed' && (
              <span className={styles.error}>{fetch.error}</span>
            )}
          </div>
          <Button size="small" loading={busy} onClick={() => dispatch(fetchGitlabBuild(job))}>
            {busy ? t(`buildsGitlab_${fetch.status}`) : t('buildsGitlabTake')}
          </Button>
        </div>
      );
    });
  }

  return (
    <section className={styles.card}>
      <div className={styles.sideHead}>
        <IconBrandGitlab size={18} stroke={1.7} className={styles.gitlabIcon} />
        <h2 className={styles.cardTitle}>{t('buildsFromGitlab')}</h2>
        {gitlab.status === 'ok' && (
          <Button
            size="small"
            type="text"
            icon={<IconRefresh size={14} />}
            onClick={() => dispatch(loadGitlabBuilds())}
          />
        )}
      </div>
      <div className={styles.stackGap}>{body}</div>
    </section>
  );
};

const RecentBuilds = () => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const history = useSelector((state) => state.builds.history);
  const currentFile = useSelector((state) => state.builds.current.file);

  if (!history.length) {
    return null;
  }
  return (
    <section className={styles.card}>
      <div className={styles.sideHead}>
        <h2 className={styles.cardTitle}>{t('buildsRecent')}</h2>
      </div>
      <div className={styles.stackGap}>
        {history.map((entry) => (
          <button
            key={entry.file}
            className={`${styles.recent} ${entry.file === currentFile ? styles.recentActive : ''}`}
            onClick={() => dispatch(openBuild(entry.file, {kind: entry.source?.kind ?? 'file', ...entry.source}))}
          >
            <PlatformIcon platform={entry.platform} size={16} />
            <span className={styles.jobText}>
              <span className={styles.ellipsis}>{entry.fileName}</span>
              <span className={`${styles.sub} ${styles.ellipsis}`}>
                {[entry.appId, versionText(entry.version, entry.build), dayjs(entry.openedAt).format('D MMM, HH:mm')]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};

/**
 * The Builds tool: install a build from a file or a GitLab pipeline, and see
 * what its manifest or Info.plist reveals.
 */
const BuildsTool = () => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const current = useSelector((state) => state.builds.current);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    dispatch(loadBuildsHistory());
  }, [dispatch]);

  if (!backend.builds) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <Alert type="info" showIcon title={t('buildsDesktopOnly')} />
        </div>
      </div>
    );
  }

  const onDrop = async (event) => {
    event.preventDefault();
    setDragging(false);
    const [file] = event.dataTransfer.files;
    if (file) {
      await dispatch(openBuild(backend.builds.pathForFile(file)));
    }
  };

  return (
    <div
      className={styles.page}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setDragging(false);
        }
      }}
      onDrop={onDrop}
    >
      <AnimatePresence>
        {dragging && (
          <motion.div
            className={styles.dropOverlay}
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            transition={{duration: 0.15}}
          >
            <IconFileUpload size={40} stroke={1.5} />
            {t('buildsDropRelease')}
          </motion.div>
        )}
      </AnimatePresence>
      {current.status === 'idle' ? (
        <Stagger className={`${styles.inner} ${styles.innerIdle}`}>
          <StaggerItem>
            <DropZone />
          </StaggerItem>
          <StaggerItem>
            <WhatWeCheck />
          </StaggerItem>
          <StaggerItem className={styles.sources}>
            <GitLabBuilds />
            <RecentBuilds />
          </StaggerItem>
        </Stagger>
      ) : (
        <Stagger className={styles.inner}>
          <div className={styles.columns}>
            <StaggerItem className={styles.mainColumn}>
              <div className={styles.row}>
                <div className={styles.grow}>
                  <DropZone compact />
                </div>
                {current.status === 'reading' && <Spin size="small" />}
              </div>
              <BuildCard />
            </StaggerItem>
            <StaggerItem className={styles.sideColumn}>
              <GitLabBuilds />
              <RecentBuilds />
            </StaggerItem>
          </div>
        </Stagger>
      )}
    </div>
  );
};

export default BuildsTool;
