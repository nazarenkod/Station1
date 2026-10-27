import {App} from 'antd';
import {AnimatePresence} from 'motion/react';
import {useEffect} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector, useStore} from 'react-redux';
import {useLocation, useNavigate, useOutlet} from 'react-router';

import {refreshA11yScreen} from '../../actions/A11y.js';
import {activeDevice, initWorkstation, isDeviceRunning, setProjectApps} from '../../actions/Workstation.js';
import {followProfile, startAgent, toggleAgent} from '../../lib/agent/agent-store.js';
import {startAgentBridge} from '../../lib/agent/bridge.js';
import {setPick} from '../../lib/agent/selection.js';
import {counts, followGoals, startGoals, useGoals} from '../../lib/goals/goals-store.js';
import {profileForApp, startProfiles, switchProfile, useProfiles} from '../../lib/settings/profiles-store.js';
import {followTaskProfile, startTasks, useTask} from '../../lib/task/task-store.js';
import {loadSessionFileIfOpened} from '../../polyfills.js';
import {useScreenFollower} from '../A11yTool/screen-follower.js';
import {useScreenHistory} from '../A11yTool/screen-history.js';
import {useScreenRecorder} from '../A11yTool/screen-recorder.js';
import AgentPanel from '../Agent/AgentPanel.jsx';
import {PageTransition} from '../AppShell/motion.jsx';
import {startPipelineWatches} from '../Builds/pipeline-watch.js';
import {loadDoctor} from '../Desk/doctor-store.js';
import GoalForm from '../Goals/GoalForm.jsx';
import {logsState, startLogs} from '../Logs/logs-store.js';
import {followSelection, usePerf} from '../Perf/perf-store.js';
import SessionExpiryModal from '../SessionInspector/SessionExpiryModal.jsx';
import {useInspectorActions} from '../SessionInspector/use-inspector.js';
import ToolRail from './ToolRail.jsx';
import {toolOf} from './tools.js';
import WorkstationHeader from './WorkstationHeader.jsx';

import goalStyles from '../Goals/Goals.module.css';
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
 * A session started outside the Inspector (by the Performance tab) is kept
 * alive and timed as one started from it. The Inspector does the same when it
 * opens; whichever comes first does it once.
 */
const SessionBootstrap = () => {
  const driver = useSelector((state) => state.inspector.driver);
  const store = useStore();
  const {actions} = useInspectorActions();
  useEffect(() => {
    if (!driver || store.getState().inspector.keepAliveInterval) {
      return;
    }
    actions.storeSessionSettings();
    actions.getSavedClientFramework();
    actions.runKeepAliveLoop();
    actions.setSessionTime(Date.now());
  }, [actions, store, driver]);
  return null;
};

/**
 * Follows and checks the screens while the app is measured and the Inspector,
 * which does it itself, is closed: the measurement marks its graphs with them.
 * The person works on the device meanwhile, often with the station behind
 * other windows, so it goes on while the window is hidden.
 */
const PerfScreenWatch = () => {
  const dispatch = useDispatch();
  const {viewingKey} = useScreenHistory();
  useEffect(() => {
    dispatch(refreshA11yScreen());
  }, [dispatch]);
  useScreenFollower({enabled: true, paused: !!viewingKey, whileHidden: true});
  useScreenRecorder();
  return null;
};

/**
 * The measurement belongs to the device and app it started with: another
 * one in the title bar stops it. While it runs, the screens are followed.
 */
const PerfFollower = () => {
  const location = useLocation();
  const workstation = useSelector((state) => state.workstation);
  const hasSession = useSelector((state) => !!state.inspector.driver);
  const perf = usePerf();
  const deviceId = activeDevice(workstation)?.id ?? null;
  const appId = workstation.app?.id ?? null;
  useEffect(() => {
    followSelection(deviceId, appId);
  }, [deviceId, appId]);
  const inspectorOpen = location.pathname === '/inspector';
  return perf.running && hasSession && !inspectorOpen ? <PerfScreenWatch /> : null;
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
 * How the goals of the session stand, over every tool but the desk, where
 * they are shown whole.
 */
const GoalsStrip = () => {
  const {t} = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const goals = useGoals();
  if (!goals.goals.length || location.pathname === '/') {
    return null;
  }
  const sum = counts();
  return (
    <button
      className={`${goalStyles.strip} ${sum.failed ? goalStyles.stripFailed : ''}`}
      data-version={goals.version}
      onClick={() => navigate('/')}
    >
      {t('goalsStrip', {passed: sum.passed, total: sum.total, failed: sum.failed})}
    </button>
  );
};

/**
 * Keeps the agent with the person: the open tab goes into the next message,
 * ⌘J opens and closes the chat, another profile has its own conversation.
 */
const AgentFollower = () => {
  const location = useLocation();
  const {t} = useTranslation();
  const profiles = useProfiles();
  useEffect(() => {
    const tool = toolOf(location.pathname);
    setPick('tab', tool ? {id: tool.key, label: t(`wsTool_${tool.key}`)} : null);
  }, [location.pathname, t]);
  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        toggleAgent();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const task = useTask();
  useEffect(() => {
    followTaskProfile();
  }, [profiles.activeId]);
  // the conversation follows the profile and its task
  useEffect(() => {
    followProfile();
  }, [profiles.activeId, task.current]);
  // the goals follow the task
  useEffect(() => {
    followGoals(task);
  }, [task]);
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
    // the agent's chat, and the window's answers to what the agent asks the station
    startAgent();
    startAgentBridge(store);
    startTasks();
    startGoals(store);
    // the doctor runs once at start, so the station's tab can say there is something to fix
    loadDoctor();
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
      <div className={styles.main}>
        <ToolRail />
        <div className={styles.mainColumn}>
          <GoalsStrip />
          <div className={styles.body}>
            <div className={styles.toolArea}>
              <AnimatePresence mode="wait">
                <PageTransition key={location.pathname}>{outlet}</PageTransition>
              </AnimatePresence>
            </div>
            <AgentPanel />
          </div>
        </div>
      </div>
      <AgentFollower />
      <GoalForm />
      <SessionKeepAlive />
      <LogsFollower />
      <SessionBootstrap />
      <PerfFollower />
      <ProfileFollower />
      <ProjectAppsFollower />
    </div>
  );
};

export default Workstation;
