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
import {setTestPaused, useStartProblems, useTestRun} from '../../lib/session/test-run.js';
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
          <span>{t(`wsStartProblem_${problem.key}`, problem.params)}</span>
          <Button size="small" type="link" onClick={() => onGo(FIX_PATH[problem.target])}>
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
  const workstation = useSelector((state) => state.workstation);
  const hasSession = useSelector((state) => !!state.inspector.driver);
  const device = activeDevice(workstation);
  const problems = useStartProblems();
  const {paused} = useTestRun();
  const [stage, setStage] = useState(null);
  const [tools, setTools] = useState(DEFAULT_SETTINGS[TEST_START]);
  const [resetOpen, setResetOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);

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
        onStage: setStage,
      });
      if (result.error) {
        message.error(t(result.error.key, result.error.params));
      } else if (!result.refused) {
        dispatch(noteSessionDevice(device.id));
        navigate('/inspector');
      }
    } finally {
      setStage(null);
    }
  };

  const blocked = !canStart(problems);
  const warned = problems.length > 0;
  const tone = blocked ? styles.startBlocked : warned ? styles.startWarned : undefined;
  const go = (path) => {
    setProblemsOpen(false);
    navigate(path);
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
          type="primary"
          icon={warned ? <IconAlertTriangle size={15} /> : <IconPlayerPlay size={15} />}
          loading={!!stage}
          className={tone}
          onClick={start}
        >
          {stage ? t(STAGE_TEXT[stage]) : t('startSession')}
        </Button>
      </Popover>
      <Dropdown
        trigger={['click']}
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
        <Button
          type="primary"
          icon={<IconChevronDown size={15} />}
          aria-label={t('wsStartTools')}
          className={tone}
          disabled={!!stage}
        />
      </Dropdown>
    </Space.Compact>
  );
};

export default StartButton;
