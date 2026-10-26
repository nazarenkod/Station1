import {IconChevronDown, IconDeviceMobile, IconPlayerPlay, IconRefresh} from '@tabler/icons-react';
import {Button, Popover, Spin} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';

import {activeDevice, isDeviceRunning, refreshDevices, selectDevice} from '../../actions/Workstation.js';
import {backend} from '../../polyfills.js';

import styles from './Workstation.module.css';

export const deviceSubtitle = (device, t) =>
  [`${device.platformName} ${device.platformVersion}`.trim(), t(`wsKind_${device.kind}`)].filter(Boolean).join(' · ');

const canBoot = (device) => device.state === 'stopped' && ['android-avd', 'ios-simulator'].includes(device.kind);

/**
 * The device every tool works with. Running devices can be picked; stopped
 * emulators and simulators can be started from here.
 */
const DevicePicker = () => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const workstation = useSelector((state) => state.workstation);
  const {devices, devicesLoaded} = workstation;
  // a background poll does not spin anything
  const devicesLoading = workstation.devicesLoading && !workstation.devicesPolling;
  const device = activeDevice(workstation);
  const [open, setOpen] = useState(false);
  const [booting, setBooting] = useState(null);

  if (!backend.doctor) {
    return null;
  }

  const running = devices.filter(isDeviceRunning);
  const others = devices.filter((candidate) => !isDeviceRunning(candidate));

  const boot = async (candidate) => {
    setBooting(candidate.id);
    try {
      await backend.doctor.bootDevice(candidate);
      await dispatch(refreshDevices());
    } finally {
      setBooting(null);
    }
  };

  const content = (
    <div className={styles.menu}>
      {running.length > 0 && <div className={styles.menuLabel}>{t('wsDevicesConnected')}</div>}
      {running.map((candidate) => (
        <button
          key={candidate.id}
          className={`${styles.menuItem} ${candidate.id === device?.id ? styles.menuItemActive : ''}`}
          onClick={async () => {
            setOpen(false);
            await dispatch(selectDevice(candidate.id));
          }}
        >
          <IconDeviceMobile size={18} stroke={1.6} />
          <span className={styles.menuItemText}>
            <span>{candidate.name}</span>
            <span className={styles.menuItemSub}>{deviceSubtitle(candidate, t)}</span>
          </span>
          <span className={`${styles.dot} ${styles.dotOn}`} />
        </button>
      ))}
      {others.length > 0 && <div className={styles.menuLabel}>{t('wsDevicesOther')}</div>}
      {others.map((candidate) => (
        <div key={candidate.id} className={styles.menuItem} style={{cursor: 'default'}}>
          <IconDeviceMobile size={18} stroke={1.6} opacity={0.5} />
          <span className={styles.menuItemText}>
            <span>{candidate.name}</span>
            <span className={styles.menuItemSub}>
              {deviceSubtitle(candidate, t)} · {t(`wsDeviceState_${candidate.state}`, {defaultValue: candidate.state})}
            </span>
          </span>
          {canBoot(candidate) && (
            <Button
              size="small"
              icon={<IconPlayerPlay size={14} />}
              loading={booting === candidate.id}
              onClick={() => boot(candidate)}
            >
              {t('wsBoot')}
            </Button>
          )}
        </div>
      ))}
      {devicesLoaded && devices.length === 0 && <div className={styles.menuLabel}>{t('wsNoDevices')}</div>}
      <div className={styles.menuFooter}>
        <Button
          size="small"
          icon={<IconRefresh size={14} />}
          loading={devicesLoading}
          onClick={() => dispatch(refreshDevices())}
        >
          {t('wsRefresh')}
        </Button>
      </div>
    </div>
  );

  return (
    <Popover content={content} trigger="click" placement="bottomLeft" open={open} onOpenChange={setOpen} arrow={false}>
      <button className={styles.picker} aria-label={t('wsPickDevice')} title={device?.name ?? t('wsNoDevice')}>
        {devicesLoading && !devicesLoaded ? <Spin size="small" /> : <IconDeviceMobile size={16} stroke={1.6} />}
        {device ? (
          <>
            <span className={`${styles.dot} ${isDeviceRunning(device) ? styles.dotOn : styles.dotOff}`} />
            <span className={styles.pickerMain}>{device.name}</span>
            <span className={styles.pickerSub}>{`${device.platformName} ${device.platformVersion}`.trim()}</span>
          </>
        ) : (
          <span className={styles.pickerEmpty}>{devicesLoaded ? t('wsNoDevice') : t('wsLookingForDevices')}</span>
        )}
        <IconChevronDown size={14} opacity={0.6} />
      </button>
    </Popover>
  );
};

export default DevicePicker;
