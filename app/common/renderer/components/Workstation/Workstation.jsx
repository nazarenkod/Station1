import {App} from 'antd';
import {AnimatePresence} from 'motion/react';
import {useEffect} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector, useStore} from 'react-redux';
import {useLocation, useNavigate, useOutlet} from 'react-router';

import {activeDevice, initWorkstation, isDeviceRunning, setProjectApps} from '../../actions/Workstation.js';
import {profileForApp, startProfiles, switchProfile, useProfiles} from '../../lib/settings/profiles-store.js';
import {loadSessionFileIfOpened} from '../../polyfills.js';
import {PageTransition} from '../AppShell/motion.jsx';
import {startPipelineWatches} from '../Builds/pipeline-watch.js';
import {logsState, startLogs} from '../Logs/logs-store.js';
import SessionExpiryModal from '../SessionInspector/SessionExpiryModal.jsx';
import {useInspectorActions} from '../SessionInspector/use-inspector.js';
import WorkstationHeader from './WorkstationHeader.jsx';

import styles from './Workstation.module.css';

/**
 * Asks to keep a quiet Appium session alive, whichever tool is open.
 */
const SessionKeepAlive = () => {
  const showKeepAlivePrompt = useSelector((state) => state.inspector.showKeepAlivePrompt);
  const {actions, quitSessionAndReturn} = useInspectorActions();
  return (
    <SessionExpiryModal
      showKeepAlivePrompt={showKeepAlivePrompt}
      keepSessionAlive={actions.keepSessionAlive}
      quitSessionAndReturn={quitSessionAndReturn}
      setUserWaitTimeout={actions.setUserWaitTimeout}
    />
  );
};

/**
 * Once the log runs, it follows the device and app chosen in the title bar,
 * whichever tool is open.
 */
const LogsFollower = () => {
  const workstation = useSelector((state) => state.workstation);
  const device = activeDevice(workstation);
  const appId = workstation.app?.id ?? null;
  const running = isDeviceRunning(device);
  useEffect(() => {
    if (running && logsState().started) {
      startLogs(device, appId);
    }
  }, [running, device, appId]);
  return null;
};

/**
 * The app comes from the project that is on: a switched project, or apps
 * changed in its profile, pick the app again.
 */
const ProjectAppsFollower = () => {
  const dispatch = useDispatch();
  const profiles = useProfiles();
  const active = profiles.list.find((profile) => profile.id === profiles.activeId);
  // a string, so the same apps in a new list do not pick again
  const apps = profiles.loaded ? JSON.stringify(active?.apps ?? []) : null;
  useEffect(() => {
    if (apps !== null) {
      dispatch(setProjectApps(JSON.parse(apps)));
    }
  }, [apps, dispatch]);
  return null;
};

/**
 * The app of a build installed from another project turns that project's
 * profile on.
 */
const ProfileFollower = () => {
  const {t} = useTranslation();
  const {message} = App.useApp();
  const appId = useSelector((state) => state.workstation.app?.id ?? null);
  useEffect(() => {
    let current = true;
    (async () => {
      const owner = await profileForApp(appId);
      if (owner && current) {
        await switchProfile(owner.id);
        message.info(t('wsProfileSwitched', {name: owner.name, app: appId}));
      }
    })();
    return () => {
      current = false;
    };
  }, [appId, message, t]);
  return null;
};

/**
 * The QA engineer's workstation: a title bar with the tools and the shared
 * device and app, and the open tool below.
 */
const Workstation = () => {
  const dispatch = useDispatch();
  const store = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const outlet = useOutlet();

  useEffect(() => {
    dispatch(initWorkstation());
    // the project profile and the tools that follow its settings
    startProfiles(store);
    // the pipelines followed for builds go on whichever tool is open
    startPipelineWatches(store);
    // a session file or a shared session link opens straight in the Inspector
    (async () => {
      const hasSessionLink = new URL(window.location.href).searchParams.has('state');
      if (hasSessionLink || (await Promise.resolve(loadSessionFileIfOpened()).catch(() => null))) {
        navigate('/session', {replace: true});
      }
    })();
  }, [dispatch, navigate, store]);

  return (
    <div className={styles.workstation}>
      <WorkstationHeader />
      <div className={styles.toolArea}>
        <AnimatePresence mode="wait">
          <PageTransition key={location.pathname}>{outlet}</PageTransition>
        </AnimatePresence>
      </div>
      <SessionKeepAlive />
      <LogsFollower />
      <ProfileFollower />
      <ProjectAppsFollower />
    </div>
  );
};

export default Workstation;
