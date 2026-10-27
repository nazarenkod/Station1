import {IconPower} from '@tabler/icons-react';
import {Button, Popconfirm} from 'antd';
import {useTranslation} from 'react-i18next';

import {backend} from '../../polyfills.js';
import {Stagger, StaggerItem} from '../AppShell/motion.jsx';
import DevicesPanel from './DevicesPanel.jsx';
import DoctorPanel from './DoctorPanel.jsx';

import styles from './Desk.module.css';

/**
 * The station itself: whether this Mac is ready (the doctor) and the devices
 * it sees. The desk is left to the work on the task.
 */
const StationPage = () => {
  const {t} = useTranslation();
  return (
    <div className={styles.desk}>
      <Stagger className={styles.inner}>
        <StaggerItem>
          <div className={styles.pageHead}>
            <h1 className={styles.pageTitle}>{t('wsTool_station')}</h1>
            {backend.doctor?.restartStation && (
              <Popconfirm
                title={t('stationRestartAsk')}
                description={t('stationRestartText')}
                okText={t('stationRestart')}
                cancelText={t('Cancel')}
                onConfirm={() => backend.doctor.restartStation()}
              >
                <Button icon={<IconPower size={15} />}>{t('stationRestart')}</Button>
              </Popconfirm>
            )}
          </div>
        </StaggerItem>
        <StaggerItem className={styles.top}>
          <DoctorPanel />
          <DevicesPanel />
        </StaggerItem>
      </Stagger>
    </div>
  );
};

export default StationPage;
