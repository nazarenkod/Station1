import {Alert, Space} from 'antd';
import {useTranslation} from 'react-i18next';

import {backend} from '../../../polyfills.js';
import DevicesCard from './DevicesCard.jsx';
import EnvironmentCard from './EnvironmentCard.jsx';
import ServersCard from './ServersCard.jsx';

import styles from './Doctor.module.css';

/**
 * The Doctor tab: Appium servers on this machine and the one the app runs
 * itself, devices to start a session on, and what the environment lacks.
 */
const Doctor = ({setDeviceCapabilities, applyLocalServer}) => {
  const {t} = useTranslation();

  if (!backend.available) {
    return <Alert type="info" showIcon title={t('doctorDesktopOnly')} />;
  }

  return (
    <Space className={styles.doctor} orientation="vertical" size="middle">
      <ServersCard doctor={backend.doctor} applyLocalServer={applyLocalServer} />
      <DevicesCard doctor={backend.doctor} setDeviceCapabilities={setDeviceCapabilities} />
      <EnvironmentCard doctor={backend.doctor} />
    </Space>
  );
};

export default Doctor;
