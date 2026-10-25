import {IconAlertTriangle, IconCircleCheck, IconCircleX, IconRefresh, IconStethoscope} from '@tabler/icons-react';
import {Button, Card, List, Modal, Space, Spin} from 'antd';
import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {log} from '../../../utils/logger.js';
import {notification} from '../../../utils/notification.js';

import styles from './Doctor.module.css';

const STATUS_ICON = {
  ok: <IconCircleCheck size={16} className={`${styles.checkIcon} ${styles.checkOk}`} />,
  warn: <IconAlertTriangle size={16} className={`${styles.checkIcon} ${styles.checkWarn}`} />,
  error: <IconCircleX size={16} className={`${styles.checkIcon} ${styles.checkError}`} />,
};

/**
 * Results of `appium driver doctor` for one driver.
 */
const DriverDoctorModal = ({driver, result, onClose}) => {
  const {t} = useTranslation();
  return (
    <Modal open={!!driver} title={t('doctorDriverDoctorTitle', {driver})} footer={null} onCancel={onClose} width={720}>
      {!result ? (
        <Spin />
      ) : !result.supported ? (
        <p>{t('doctorDriverDoctorUnsupported')}</p>
      ) : (
        <List
          size="small"
          dataSource={result.items}
          renderItem={(item) => (
            <List.Item>
              <div className={styles.checkRow}>
                {STATUS_ICON[item.status]}
                <span className={styles.checkText}>{item.text}</span>
              </div>
            </List.Item>
          )}
        />
      )}
    </Modal>
  );
};

/**
 * What a session needs on this machine, with fixes where the app can apply them.
 */
const EnvironmentCard = ({doctor}) => {
  const {t} = useTranslation();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(null);
  const [driverDoctor, setDriverDoctor] = useState({driver: null, result: null});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await doctor.environment());
    } catch (e) {
      log.error(e);
    } finally {
      setLoading(false);
    }
  }, [doctor]);

  useEffect(() => {
    load();
  }, [load]);

  const installDriver = async (driver) => {
    setFixing(driver);
    try {
      const ok = await doctor.installDriver(driver);
      if (ok) {
        notification.success({title: t('doctorDriverInstalled', {driver})});
        await load();
      } else {
        notification.error({title: t('doctorDriverInstallFailed', {driver})});
      }
    } finally {
      setFixing(null);
    }
  };

  const runDriverDoctor = async (driver) => {
    setDriverDoctor({driver, result: null});
    setDriverDoctor({driver, result: await doctor.driverDoctor(driver)});
  };

  const installedDrivers = Object.keys(report?.drivers ?? {});

  return (
    <Card
      size="small"
      title={
        <Space>
          <IconStethoscope size={18} />
          {t('doctorEnvironment')}
        </Space>
      }
      extra={
        <Button size="small" icon={<IconRefresh size={14} />} loading={loading} onClick={load}>
          {t('doctorRefresh')}
        </Button>
      }
    >
      <Spin spinning={loading && !report}>
        <List
          size="small"
          dataSource={report?.checks ?? []}
          renderItem={(check) => (
            <List.Item>
              <div className={styles.checkRow}>
                {STATUS_ICON[check.status]}
                <span className={styles.checkText}>{t(`doctorCheck_${check.id}_${check.status}`, check.params)}</span>
                {check.fix?.action === 'installDriver' && (
                  <Button
                    size="small"
                    loading={fixing === check.fix.driver}
                    onClick={() => installDriver(check.fix.driver)}
                  >
                    {t('doctorInstallDriver', {driver: check.fix.driver})}
                  </Button>
                )}
              </div>
            </List.Item>
          )}
        />
        {installedDrivers.length > 0 && (
          <Space wrap style={{marginTop: 8}}>
            {installedDrivers.map((driver) => (
              <Button key={driver} size="small" onClick={() => runDriverDoctor(driver)}>
                {t('doctorRunDriverDoctor', {driver})}
              </Button>
            ))}
          </Space>
        )}
      </Spin>
      <DriverDoctorModal
        driver={driverDoctor.driver}
        result={driverDoctor.result}
        onClose={() => setDriverDoctor({driver: null, result: null})}
      />
    </Card>
  );
};

export default EnvironmentCard;
