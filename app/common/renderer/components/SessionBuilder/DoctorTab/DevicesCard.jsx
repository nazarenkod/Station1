import {IconBrandAndroid, IconBrandApple, IconDeviceMobile, IconPlayerPlay, IconRefresh} from '@tabler/icons-react';
import {Button, Card, Empty, Space, Table, Tag, Tooltip} from 'antd';
import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {log} from '../../../utils/logger.js';
import {notification} from '../../../utils/notification.js';

// Booting takes a while; the list is refreshed this long after a start
const REFRESH_AFTER_BOOT_MS = 15000;

const STATE_COLOR = {
  running: 'success',
  stopped: 'default',
  disconnected: 'default',
  offline: 'warning',
  unauthorized: 'error',
};

const canBoot = (device) => device.state === 'stopped' && ['android-avd', 'ios-simulator'].includes(device.kind);

/**
 * Devices a session can run on. Picking one fills in the capabilities.
 */
const DevicesCard = ({doctor, setDeviceCapabilities}) => {
  const {t} = useTranslation();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDevices((await doctor.devices()).devices);
    } catch (e) {
      log.error(e);
    } finally {
      setLoading(false);
    }
  }, [doctor]);

  useEffect(() => {
    load();
  }, [load]);

  const boot = async (device) => {
    setBooting(device.id);
    try {
      const result = await doctor.bootDevice(device);
      if (!result.ok) {
        notification.error({title: t('doctorBootFailed', {name: device.name}), description: result.error});
        return;
      }
      notification.info({title: t('doctorBooting', {name: device.name}), duration: 4});
      setTimeout(load, REFRESH_AFTER_BOOT_MS);
    } finally {
      setBooting(null);
    }
  };

  const use = (device) => {
    setDeviceCapabilities(device.capabilities);
    notification.success({title: t('doctorCapsFilled', {name: device.name}), duration: 3});
  };

  const columns = [
    {
      title: t('doctorDevice'),
      key: 'name',
      render: (_, device) => (
        <Space>
          {device.platformName === 'Android' ? <IconBrandAndroid size={16} /> : <IconBrandApple size={16} />}
          {device.name}
          {device.platformVersion && <span>{device.platformVersion}</span>}
        </Space>
      ),
    },
    {
      title: t('doctorDeviceKind'),
      key: 'kind',
      render: (_, device) => t(`doctorDeviceKind_${device.kind}`),
    },
    {
      title: t('doctorDeviceState'),
      key: 'state',
      render: (_, device) => (
        <Tooltip title={t(`doctorDeviceStateHint_${device.state}`, {defaultValue: ''})}>
          <Tag color={STATE_COLOR[device.state] ?? 'default'}>{t(`doctorDeviceState_${device.state}`)}</Tag>
        </Tooltip>
      ),
    },
    {
      key: 'actions',
      align: 'right',
      render: (_, device) => (
        <Space>
          {canBoot(device) && (
            <Button
              size="small"
              icon={<IconPlayerPlay size={14} />}
              loading={booting === device.id}
              onClick={() => boot(device)}
            >
              {t('doctorBoot')}
            </Button>
          )}
          <Button
            size="small"
            type="primary"
            disabled={['offline', 'unauthorized'].includes(device.state)}
            onClick={() => use(device)}
          >
            {t('doctorUseDevice')}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Card
      size="small"
      title={
        <Space>
          <IconDeviceMobile size={18} />
          {t('doctorDevices')}
        </Space>
      }
      extra={
        <Button size="small" icon={<IconRefresh size={14} />} loading={loading} onClick={load}>
          {t('doctorRefresh')}
        </Button>
      }
    >
      {devices.length || loading ? (
        <Table
          size="small"
          pagination={false}
          rowKey={(d) => `${d.kind}:${d.id}`}
          dataSource={devices}
          columns={columns}
          loading={loading}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('doctorNoDevices')} />
      )}
    </Card>
  );
};

export default DevicesCard;
