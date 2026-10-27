import {IconPlayerPlay, IconRefresh} from '@tabler/icons-react';
import {Button, Skeleton} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';

import {isDeviceRunning, refreshDevices, selectDevice} from '../../actions/Workstation.js';
import {backend} from '../../polyfills.js';
import {appsProblemText} from '../Workstation/app-labels.js';
import {deviceSubtitle} from '../Workstation/DevicePicker.jsx';
import {needsFix, PanelFoot, RowCard, VISIBLE_ROWS} from './DoctorPanel.jsx';

import styles from './Desk.module.css';

const BOOTABLE = ['android-avd', 'ios-simulator'];
const canBoot = (device) => device.state === 'stopped' && BOOTABLE.includes(device.kind);

// what to do about a device that cannot run, by its state
const UNAVAILABLE_FIX = {
  broken: {key: 'deviceBroken'},
  unauthorized: {key: 'deviceUnauthorized'},
  offline: {key: 'deviceOffline', command: 'adb kill-server && adb start-server'},
  disconnected: {key: 'deviceDisconnected'},
};

/**
 * One device: a coloured status, its name, and an action that shows on
 * hover. Pointing at it shows what is wrong with it and how to fix it.
 */
const DeviceRow = ({device, status, note, card, action, active}) => (
  <li>
    <RowCard card={card} placement="bottomLeft">
      <div
        className={`${styles.statusRow} ${styles.deviceRow} ${active ? styles.deviceActive : ''}`}
        title={needsFix(card.status) ? undefined : card.text}
      >
        <span className={`${styles.statusDot} ${styles[`status_${status}`]}`} aria-hidden="true" />
        <span className={styles.statusName}>
          <span className={active ? styles.deviceNameActive : undefined}>{device.name}</span>
          <span className={styles.deviceSub}> · {note}</span>
        </span>
        {action && <span className={active ? styles.rowActionShown : styles.rowAction}>{action}</span>}
      </div>
    </RowCard>
  </li>
);

/**
 * The devices: the active one and the other connected ones stay in view, the
 * rest (ones that can be started, ones that cannot run) fold away.
 */
const DevicesPanel = () => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const workstation = useSelector((state) => state.workstation);
  const {devices, deviceId, devicesLoaded, appsError} = workstation;
  const devicesLoading = workstation.devicesLoading && !workstation.devicesPolling;
  const [booting, setBooting] = useState(null);
  const [open, setOpen] = useState(false);

  if (!backend.doctor) {
    return null;
  }

  // a started emulator or simulator becomes the active device right away
  const bootAndPick = async (device) => {
    setBooting(device.id);
    try {
      await backend.doctor.bootDevice(device);
      await dispatch(refreshDevices());
      await dispatch(selectDevice(device.id));
    } finally {
      setBooting(null);
    }
  };

  const bootButton = (device) => (
    <Button
      size="small"
      icon={<IconPlayerPlay size={13} />}
      loading={booting === device.id}
      onClick={() => bootAndPick(device)}
    >
      {t('deskBootAndPick')}
    </Button>
  );

  const active = devices.find((d) => d.id === deviceId) ?? null;
  const others = devices.filter((d) => d.id !== deviceId);
  const connected = others.filter(isDeviceRunning);
  const startable = others.filter(canBoot);
  const unavailable = others.filter((d) => !isDeviceRunning(d) && !canBoot(d));

  let activeRow = null;
  if (active) {
    const running = isDeviceRunning(active);
    const problem = appsError ? appsProblemText(appsError, t) : null;
    const status = problem ? 'error' : running ? 'ok' : 'off';
    const command = appsError ? t(`deskFixCmd_device_${appsError.reason}`, {defaultValue: ''}) : '';
    activeRow = (
      <DeviceRow
        key={active.id}
        device={active}
        active
        status={status}
        note={problem ? `${deviceSubtitle(active, t)} · ${t('deskDeviceNeedsFix')}` : deviceSubtitle(active, t)}
        card={{
          name: active.name,
          value: deviceSubtitle(active, t),
          status,
          text:
            problem ??
            (running ? t('deskDeviceActiveOk') : t(`wsDeviceState_${active.state}`, {defaultValue: active.state})),
          fixText: appsError ? t(`deskFix_device_${appsError.reason}`, {defaultValue: ''}) : '',
          command: command || undefined,
          action: !running && canBoot(active) ? bootButton(active) : null,
        }}
        action={
          !running && canBoot(active) ? bootButton(active) : <span className={styles.activeTag}>{t('deskActive')}</span>
        }
      />
    );
  }

  return (
    <section
      className={`vi-panel ${styles.listPanel} ${open ? styles.listPanelOpen : ''}`}
      aria-labelledby="desk-devices"
    >
      <div className={styles.panelHead}>
        <h2 id="desk-devices" className={styles.cardTitle}>
          {t('deskDevices')}
        </h2>
        <span className={styles.dim}>
          {t('deskDevicesCount', {running: devices.filter(isDeviceRunning).length, total: devices.length})}
        </span>
        <span className={styles.spacer} />
        <Button
          size="small"
          type="text"
          aria-label={t('wsRefresh')}
          title={t('wsRefresh')}
          icon={<IconRefresh size={14} />}
          loading={devicesLoading}
          onClick={() => dispatch(refreshDevices())}
        />
      </div>

      {!devicesLoaded ? (
        <Skeleton active title={false} paragraph={{rows: 2}} className={styles.panelSkeleton} />
      ) : (
        <>
          <ul className={styles.statusList}>
            {activeRow}
            {!active && <li className={styles.noActive}>{t('deskNoActiveDevice')}</li>}
            {connected.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                status="ok"
                note={deviceSubtitle(device, t)}
                card={{
                  name: device.name,
                  value: deviceSubtitle(device, t),
                  status: 'ok',
                  text: t('deskDeviceConnected'),
                }}
                action={
                  <Button size="small" onClick={() => dispatch(selectDevice(device.id))}>
                    {t('deskMakeActive')}
                  </Button>
                }
              />
            ))}
            {startable.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                status="off"
                note={deviceSubtitle(device, t)}
                card={{
                  name: device.name,
                  value: deviceSubtitle(device, t),
                  status: 'off',
                  text: t('deskDeviceStartable'),
                }}
                action={bootButton(device)}
              />
            ))}
            {unavailable.map((device) => {
              const fix = UNAVAILABLE_FIX[device.state];
              return (
                <DeviceRow
                  key={device.id}
                  device={device}
                  status="warn"
                  note={t(`wsDeviceState_${device.state}`, {defaultValue: device.state})}
                  card={{
                    name: device.name,
                    value: deviceSubtitle(device, t),
                    status: 'warn',
                    text: t(`wsDeviceState_${device.state}`, {defaultValue: device.state}),
                    fixText: fix ? t(`deskFix_${fix.key}`) : '',
                    command: fix?.command,
                  }}
                />
              );
            })}
          </ul>
          <PanelFoot
            open={open}
            onToggle={() => setOpen(!open)}
            hidden={Math.max(0, devices.length + (active ? 0 : 1) - VISIBLE_ROWS)}
            summary={t('deskDevicesTotal', {count: devices.length})}
          />
        </>
      )}
    </section>
  );
};

export default DevicesPanel;
