import {Checkbox, Modal} from 'antd';
import dayjs from 'dayjs';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';

import {A11Y_SCAN_CLEARED} from '../../actions/A11y.js';
import {SET_BUILD} from '../../actions/Builds.js';
import {newGoalRun} from '../../lib/goals/goals-store.js';
import {clearScreenHistory} from '../A11yTool/screen-history.js';
import {clearLogs, useLogs} from '../Logs/logs-store.js';
import {clearPerf, usePerf} from '../Perf/perf-store.js';
import {clearTraffic, useProxy} from '../Proxy/proxy-store.js';

import styles from './Desk.module.css';

/**
 * Starts a new test: what the tools collected so far is cleared, so new
 * problems do not mix with old ones. Rules, settings, the device and the
 * Appium session stay. The open build stays unless asked.
 */
const NewTestDialog = ({open, onClose, onDone}) => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const proxy = useProxy();
  const logs = useLogs();
  const perf = usePerf();
  const scan = useSelector((state) => state.inspector.a11yScan);
  const screen = useSelector((state) => state.inspector.a11yScreen);
  const build = useSelector((state) => state.builds.current);
  const [picked, setPicked] = useState({traffic: true, logs: true, perf: true, audit: true, build: false});

  const items = [
    {key: 'traffic', dot: 'proxy', count: proxy.order.length, sub: t('deskResetTrafficSub')},
    {key: 'logs', dot: 'logs', count: logs.entries.length, sub: t('deskResetLogsSub')},
    {key: 'perf', dot: 'perf', count: perf.samples.length, sub: t('deskResetPerfSub')},
    {
      key: 'audit',
      dot: 'a11y',
      count: scan ? scan.violations.length : 0,
      sub: scan ? t('deskResetAuditSub', {screen: screen?.title || '—'}) : t('deskA11yNotYet'),
    },
    {
      key: 'build',
      dot: 'builds',
      count: build.status === 'ready' ? build.findings.length : 0,
      sub:
        build.status === 'ready'
          ? t('deskResetBuildSub', {version: build.build.version || build.build.build})
          : t('deskResetNoBuild'),
    },
  ];

  const reset = async () => {
    if (picked.traffic) {
      await clearTraffic();
    }
    if (picked.logs) {
      await clearLogs();
    }
    if (picked.perf) {
      clearPerf();
    }
    if (picked.audit) {
      dispatch({type: A11Y_SCAN_CLEARED});
      clearScreenHistory();
    }
    if (picked.build && build.status !== 'idle') {
      dispatch({type: SET_BUILD, current: {status: 'idle'}});
    }
    // the goals of the task count again from here
    newGoalRun();
    onDone?.(dayjs().format('HH:mm'));
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={reset}
      okText={t('deskNewTestStart')}
      cancelText={t('Cancel')}
      okButtonProps={{disabled: !Object.values(picked).some(Boolean)}}
      title={t('deskNewTestTitle')}
      width={520}
      destroyOnHidden
    >
      <p className={styles.resetLead}>{t('deskNewTestLead')}</p>
      <ul className={styles.resetList}>
        {items.map((item) => (
          <li key={item.key}>
            <Checkbox
              checked={picked[item.key]}
              onChange={(e) => setPicked({...picked, [item.key]: e.target.checked})}
              className={styles.resetItem}
            >
              <span className={`${styles.toolDot} ${styles[`tool_${item.dot}`]}`} aria-hidden="true" />
              <span className={styles.resetText}>
                <span className={styles.resetName}>{t(`deskReset_${item.key}`)}</span>
                <span className={styles.resetSub}>{item.sub}</span>
              </span>
              <span className={`vi-num ${styles.resetCount}`}>{item.count}</span>
            </Checkbox>
          </li>
        ))}
      </ul>
    </Modal>
  );
};

export default NewTestDialog;
