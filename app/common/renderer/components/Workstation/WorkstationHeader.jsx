import {IconSettings} from '@tabler/icons-react';
import {Tooltip} from 'antd';
import {useTranslation} from 'react-i18next';
import {useLocation, useNavigate} from 'react-router';

import {PRODUCT_NAME} from '../../../shared/product.js';
import logo from '../../assets/images/vision-logo.svg';
import DevicePicker from './DevicePicker.jsx';
import ProfilePicker from './ProfilePicker.jsx';
import SessionChip from './SessionChip.jsx';
import ToolTabs from './ToolTabs.jsx';

import styles from './Workstation.module.css';

/**
 * The window's title bar in one row: the brand, the tools, the project (its
 * profile names the app) and the device every tool shares, the session, and
 * the settings.
 */
const WorkstationHeader = () => {
  const {t} = useTranslation();
  const navigate = useNavigate();
  const {pathname} = useLocation();

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <img src={logo} alt="" className={styles.brandMark} />
        <span className={styles.wordmark}>{PRODUCT_NAME}</span>
      </div>
      <ToolTabs />
      <div className={styles.spacer} />
      <div className={styles.context}>
        <ProfilePicker />
        <span className={styles.contextDivider} />
        <DevicePicker />
      </div>
      <SessionChip />
      <Tooltip title={t('wsSettings')}>
        <button
          aria-label={t('wsSettings')}
          aria-current={pathname === '/settings' ? 'page' : undefined}
          className={`${styles.iconButton} ${pathname === '/settings' ? styles.iconButtonOn : ''}`}
          onClick={() => navigate('/settings')}
        >
          <IconSettings size={18} stroke={1.7} />
        </button>
      </Tooltip>
    </header>
  );
};

export default WorkstationHeader;
