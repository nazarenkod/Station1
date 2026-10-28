import {IconAlertTriangle, IconChevronDown, IconPlayerPause, IconPlayerPlay, IconRefresh} from '@tabler/icons-react';
import {App, Button, Checkbox, Dropdown, Popover, Space, Tooltip} from 'antd';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {DEFAULT_SETTINGS, TEST_START} from '../../../shared/setting-defs.js';
import {canStart} from '../../../shared/start-problems.js';
import {activeDevice, noteSessionDevice} from '../../actions/Workstation.js';
import {startEverything} from '../../lib/session/start-all.js';
import {setTestPaused, startProblemText, useStartProblems, useTestRun} from '../../lib/session/test-run.js';
import {useJoinSession} from '../../lib/session/use-join-session.js';
import {backend, getSetting, setSetting} from '../../polyfills.js';
import NewTestDialog from '../Desk/NewTestDialog.jsx';

import styles from './Workstation.module.css';

const STAGE_TEXT = {tools: 'wsStartingTools', server: 'quickStartingServer', session: 'quickStarting'};
const TOOLS = ['proxy', 'logs', 'perf'];
// where each problem is fixed
const FIX_PATH = {device: '/station', app: '/settings', station: '/station'};

/** What the start needs, each with the way to fix it. */
const ProblemList = ({problems, onGo}) => {
  const {t} = useTranslation();
  return (
    <ul className={styles.startProblems}>
      {problems.map((problem) => (
        <li key={problem.key} className={styles[`startProblem_${problem.severity}`]}>
          <IconAlertTriangle size={14} />
          <span>{startProblemText(t, problem)}</span>
          <Button size="small" type="link" onClick={() => onGo(FIX_PATH[problem.target], problem.fix)}>
            {t(`wsStartFix_${problem.target}`)}
          </Button>
        </li>
      ))}
    </ul>
  );
};

/**
 * The test in the title bar. With no session: «Start session», with the
 * choice of what starts along (the proxy, the log, the measurement) and what
 * is not set up lit. With one: «Pause» / «Go on» of the recording and
 * «Reset» for a new test.
 */
const StartButton = () => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const {message} = App.useApp();
  const {decide, joined} = useJoinSession();
  const workstation = useSelector((state) => state.workstation);
  const hasSession = useSelector((state) => !!state.inspector.driver);
  const device = activeDevice(workstation);
  const problems = useStartProblems();
  const {paused} = useTestRun();
  const [stage, setStage] = useState(null);
  const [tools, setTools] = useState(DEFAULT_SETTINGS[TEST_START]);
  const [resetOpen, setResetOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  useEffect(() => {
    getSetting(TEST_START).then((saved) => setTools({...DEFAULT_SETTINGS[TEST_START], ...(saved ?? {})}));
  }, []);

  // a session that ended takes the pause with it: the next test records from its start
  useEffect(() => {
    if (!hasSession && paused) {
      setTestPaused(false);
    }
  }, [hasSession, paused]);

  if (!backend.doctor) {
    return null;
  }

  if (hasSession) {
    return (
      <Space.Compact>
        <Tooltip title={paused ? t('wsTestResumeHint') : t('wsTestPauseHint')}>
          <Button
            icon={paused ? <IconPlayerPlay size={15} /> : <IconPlayerPause size={15} />}
            className={paused ? styles.testPaused : undefined}
            onClick={() => setTestPaused(!paused)}
          >
            {paused ? t('wsTestResume') : t('wsTestPause')}
          </Button>
        </Tooltip>
        <Tooltip title={t('wsTestResetHint')}>
          <Button icon={<IconRefresh size={15} />} onClick={() => setResetOpen(true)} aria-label={t('wsTestReset')}>
            {t('wsTestReset')}
          </Button>
        </Tooltip>
        <NewTestDialog
          open={resetOpen}
          onClose={() => setResetOpen(false)}
          onDone={(time) => message.success(t('deskNewTestDone', {time}))}
        />
      </Space.Compact>
    );
  }

  const toggleTool = async (key) => {
    const next = {...tools, [key]: !tools[key]};
    setTools(next);
    await setSetting(TEST_START, next);
  };

  const start = async () => {
    if (!canStart(problems)) {
      setProblemsOpen(true);
      return;
    }
    try {
      const result = await startEverything({
        dispatch,
        device,
        app: workstation.app,
        appium: workstation.appium,
        decide,
        onStage: setStage,
      });
      if (result.error) {
        message.error(t(result.error.key, result.error.params));
      } else if (!result.refused) {
        joined(result);
        dispatch(noteSessionDevice(device.id));
        navigate('/inspector');
      }
    } finally {
      setStage(null);
    }
  };

  const blocked = !canStart(problems);
  const warned = problems.length > 0;
  // a start that waits for something is outlined in amber or red, not filled: the filled violet stays for «ready»
  const tone = blocked
    ? {color: 'danger', variant: 'outlined'}
    : warned
      ? {color: 'orange', variant: 'outlined'}
      : {type: 'primary'};
  const go = (path, state) => {
    setProblemsOpen(false);
    navigate(path, state ? {state} : undefined);
  };

  return (
    <Space.Compact>
      <Popover
        open={warned && problemsOpen}
        onOpenChange={(open) => setProblemsOpen(open && warned)}
        trigger={['hover']}
        placement="bottom"
        title={blocked ? t('wsStartBlocked') : t('wsStartWarned')}
        content={<ProblemList problems={problems} onGo={go} />}
      >
        <Button
          {...tone}
          icon={warned ? <IconAlertTriangle size={15} /> : <IconPlayerPlay size={15} />}
          loading={!!stage}
          onClick={start}
        >
          {stage ? t(STAGE_TEXT[stage]) : t('startSession')}
        </Button>
      </Popover>
      <Dropdown
        trigger={['click']}
        open={toolsOpen}
        // a pick in the menu keeps it open: several are often switched at once
        onOpenChange={(open, info) => (open || info?.source !== 'menu') && setToolsOpen(open)}
        menu={{
          items: TOOLS.map((key) => ({
            key,
            label: (
              <Checkbox checked={!!tools[key]} className={styles.startTool}>
                {t(`wsStartTool_${key}`)}
              </Checkbox>
            ),
          })),
          onClick: ({key, domEvent}) => {
            domEvent.preventDefault();
            toggleTool(key);
          },
        }}
      >
        <Button {...tone} icon={<IconChevronDown size={15} />} aria-label={t('wsStartTools')} disabled={!!stage} />
      </Dropdown>
    </Space.Compact>
  );
};

export default StartButton;
