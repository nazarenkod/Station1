import {AnimatePresence} from 'motion/react';
import {useEffect} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {useLocation, useNavigate, useOutlet} from 'react-router';

import {activeDevice, initWorkstation, isDeviceRunning} from '../../actions/Workstation.js';
import {loadSessionFileIfOpened} from '../../polyfills.js';
import {PageTransition} from '../AppShell/motion.jsx';
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
 * The QA engineer's workstation: a title bar with the tools and the shared
 * device and app, and the open tool below.
 */
const Workstation = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const outlet = useOutlet();

  useEffect(() => {
    dispatch(initWorkstation());
    // a session file or a shared session link opens straight in the Inspector
    (async () => {
      const hasSessionLink = new URL(window.location.href).searchParams.has('state');
      if (hasSessionLink || (await Promise.resolve(loadSessionFileIfOpened()).catch(() => null))) {
        navigate('/session', {replace: true});
      }
    })();
  }, [dispatch, navigate]);

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
    </div>
  );
};

export default Workstation;
