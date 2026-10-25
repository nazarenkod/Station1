import {Alert} from 'antd';
import {useTranslation} from 'react-i18next';

import {backend} from '../../../polyfills.js';
import {Stagger, StaggerItem} from '../../AppShell/motion.jsx';
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
    <Stagger className={styles.doctor}>
      <StaggerItem>
        <ServersCard doctor={backend.doctor} applyLocalServer={applyLocalServer} />
      </StaggerItem>
      <StaggerItem>
        <DevicesCard doctor={backend.doctor} setDeviceCapabilities={setDeviceCapabilities} />
      </StaggerItem>
      <StaggerItem>
        <EnvironmentCard doctor={backend.doctor} />
      </StaggerItem>
    </Stagger>
  );
};

export default Doctor;
