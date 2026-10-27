import {IconBrain} from '@tabler/icons-react';
import {Tooltip} from 'antd';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router';

import {PRODUCT_NAME} from '../../../shared/product.js';
import logo from '../../assets/images/vision-logo.svg';
import {toggleAgent, useAgent} from '../../lib/agent/agent-store.js';
import {useTask} from '../../lib/task/task-store.js';
import DevicePicker from './DevicePicker.jsx';
import ProfilePicker from './ProfilePicker.jsx';
import SessionChip from './SessionChip.jsx';

import styles from './Workstation.module.css';

/**
 * The window's title bar in one row: the brand, the tools, the project (its
 * profile names the app) and the device every tool shares, the session, and
 * the settings.
 */
const WorkstationHeader = () => {
  const {t} = useTranslation();
  const navigate = useNavigate();
  const agent = useAgent();
  const task = useTask();

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <img src={logo} alt="" className={styles.brandMark} />
        <span className={styles.wordmark}>{PRODUCT_NAME}</span>
      </div>
      <div className={styles.spacer} />
      {task.current && (
        <Tooltip title={t('taskTitle')}>
          <button className={styles.taskChip} onClick={() => navigate('/')}>
            {task.current}
          </button>
        </Tooltip>
      )}
      <div className={styles.context}>
        <ProfilePicker />
        <span className={styles.contextDivider} />
        <DevicePicker />
      </div>
      <SessionChip />
      <Tooltip title={`${t('agentTitle')} · ⌘J`}>
        <button
          aria-label={t('agentTitle')}
          aria-pressed={agent.open}
          className={`${styles.iconButton} ${agent.open ? styles.iconButtonOn : ''} ${styles.agentButton}`}
          onClick={() => toggleAgent()}
        >
          <IconBrain size={18} stroke={1.7} />
          {(agent.status === 'busy' || agent.permissions.length > 0) && (
            <span className={`${styles.agentDot} ${agent.permissions.length ? styles.agentDotAsk : ''}`} />
          )}
        </button>
      </Tooltip>
    </header>
  );
};

export default WorkstationHeader;
