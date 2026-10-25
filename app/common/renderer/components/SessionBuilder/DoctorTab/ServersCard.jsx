import {IconPlayerPlay, IconPlayerStop, IconRefresh, IconServer, IconTrash} from '@tabler/icons-react';
import {Button, Card, Collapse, Empty, InputNumber, Popconfirm, Space, Table, Tag, Tooltip} from 'antd';
import {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {log} from '../../../utils/logger.js';
import {notification} from '../../../utils/notification.js';

import styles from './Doctor.module.css';

const MAX_SHOWN_LOG_LINES = 500;
const DEFAULT_PORT = 4723;

const STATUS_COLOR = {
  stopped: 'default',
  installing: 'processing',
  starting: 'processing',
  running: 'success',
  failed: 'error',
};

/**
 * Lines of the server log, appended as the main process sends them.
 */
const useServerLog = (doctor) => {
  const [state, setState] = useState({status: 'stopped'});
  const [lines, setLines] = useState([]);
  const nextLineId = useRef(0);

  useEffect(() => {
    let active = true;
    const toLine = (text, stream) => ({id: nextLineId.current++, text, stream});
    doctor.getServer().then(({state: current, logs}) => {
      if (active) {
        setState(current);
        setLines(logs.slice(-MAX_SHOWN_LOG_LINES).map((text) => toLine(text, 'out')));
      }
    });
    const offState = doctor.onServerState(setState);
    const offLog = doctor.onServerLog(({lines: added, stream}) =>
      setLines((prev) => [...prev, ...added.map((text) => toLine(text, stream))].slice(-MAX_SHOWN_LOG_LINES)),
    );
    return () => {
      active = false;
      offState();
      offLog();
    };
  }, [doctor]);

  return {state, lines};
};

const ServerLog = ({lines}) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [lines]);
  return (
    <pre className={styles.serverLog} ref={ref}>
      {lines.map((line) => (
        <div key={line.id} className={styles[line.stream]}>
          {line.text}
        </div>
      ))}
    </pre>
  );
};

/**
 * Appium servers on this machine, and the one Vision Inspector runs itself.
 */
const ServersCard = ({doctor, applyLocalServer}) => {
  const {t} = useTranslation();
  const [servers, setServers] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [port, setPort] = useState(DEFAULT_PORT);
  const [busy, setBusy] = useState(false);
  const {state, lines} = useServerLog(doctor);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      setServers(await doctor.servers());
    } catch (e) {
      log.error(e);
    } finally {
      setScanning(false);
    }
  }, [doctor]);

  useEffect(() => {
    scan();
  }, [scan]);

  // the list follows our own server starting and stopping
  useEffect(() => {
    if (state.status === 'running' || state.status === 'stopped') {
      scan();
    }
  }, [state.status, scan]);

  const start = async () => {
    setBusy(true);
    try {
      const result = await doctor.startServer({port});
      if (result.status === 'running') {
        await applyLocalServer({hostname: '127.0.0.1', port, path: ''});
        notification.success({title: t('doctorServerStarted', {port})});
      } else if (result.error) {
        const [reason, detail] = result.error.split(':');
        notification.error({title: t(`doctorServerError_${reason}`, {port, detail, defaultValue: result.error})});
      }
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    setBusy(true);
    try {
      const drivers = ['uiautomator2', ...(navigator.platform.startsWith('Mac') ? ['xcuitest'] : [])];
      if (await doctor.installAppium(drivers)) {
        notification.success({title: t('doctorAppiumInstalled')});
      }
    } finally {
      setBusy(false);
    }
  };

  const removeSession = async (server, sessionId) => {
    const result = await doctor.deleteSession(server, sessionId);
    if (!result.ok) {
      notification.error({title: result.error});
    }
    await scan();
  };

  const ownPort = state.status === 'running' ? state.port : null;
  const isBusy = busy || ['installing', 'starting'].includes(state.status);

  const columns = [
    {
      title: t('doctorServer'),
      key: 'url',
      render: (_, server) => (
        <Space>
          <code>{server.url}</code>
          {server.port === ownPort && <Tag color="blue">{t('doctorOwnServer')}</Tag>}
        </Space>
      ),
    },
    {title: t('doctorVersion'), dataIndex: 'version', key: 'version', render: (version) => version ?? '—'},
    {
      title: t('doctorSessions'),
      key: 'sessions',
      render: (_, server) =>
        server.sessions ? (
          server.sessions.length
        ) : (
          <Tooltip title={t('doctorSessionsHidden')}>
            <span>—</span>
          </Tooltip>
        ),
    },
    {
      key: 'actions',
      align: 'right',
      render: (_, server) => (
        <Button size="small" type="primary" onClick={() => applyLocalServer(server)}>
          {t('doctorUseServer')}
        </Button>
      ),
    },
  ];

  const sessionRows = (server) => (
    <Table
      size="small"
      pagination={false}
      rowKey="id"
      dataSource={server.sessions}
      columns={[
        {title: 'ID', dataIndex: 'id', key: 'id', render: (id) => <code>{id}</code>},
        {
          title: t('doctorDevice'),
          key: 'device',
          render: (_, s) => [s.platformName, s.deviceName || s.udid].join(' · '),
        },
        {
          key: 'actions',
          align: 'right',
          render: (_, session) => (
            <Popconfirm title={t('doctorDeleteSessionConfirm')} onConfirm={() => removeSession(server, session.id)}>
              <Tooltip title={t('doctorDeleteSession')}>
                <Button size="small" danger icon={<IconTrash size={14} />} />
              </Tooltip>
            </Popconfirm>
          ),
        },
      ]}
    />
  );

  return (
    <Card
      size="small"
      title={
        <Space>
          <IconServer size={18} />
          {t('doctorServers')}
        </Space>
      }
      extra={
        <Button size="small" icon={<IconRefresh size={14} />} loading={scanning} onClick={scan}>
          {t('doctorRefresh')}
        </Button>
      }
    >
      <Space orientation="vertical" size="middle" style={{width: '100%'}}>
        {servers.length ? (
          <Table
            size="small"
            pagination={false}
            rowKey="url"
            dataSource={servers}
            columns={columns}
            expandable={{expandedRowRender: sessionRows, rowExpandable: (server) => server.sessions?.length > 0}}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('doctorNoServers')} />
        )}

        {doctor.managedServer && (
          <div className={styles.cardActions}>
            <Tag color={STATUS_COLOR[state.status]} className={styles.statusTag}>
              <span className={`vi-dot ${state.status === 'running' || isBusy ? 'vi-dot-live' : ''}`} />
              {t(`doctorServerStatus_${state.status}`)}
            </Tag>
            {state.status === 'running' ? (
              <Button icon={<IconPlayerStop size={16} />} danger onClick={() => doctor.stopServer()}>
                {t('doctorStopServer')}
              </Button>
            ) : (
              <>
                <Space.Compact>
                  <Space.Addon>{t('Remote Port')}</Space.Addon>
                  <InputNumber min={1} max={65535} value={port} onChange={(value) => setPort(value ?? DEFAULT_PORT)} />
                </Space.Compact>
                <Button type="primary" icon={<IconPlayerPlay size={16} />} loading={isBusy} onClick={start}>
                  {t('doctorStartServer')}
                </Button>
                {/* an Appium from PATH that failed is often outdated: offer our own */}
                {state.status === 'failed' && !state.local && (
                  <Button loading={isBusy} onClick={install}>
                    {t('doctorInstallAppium')}
                  </Button>
                )}
              </>
            )}
          </div>
        )}

        {doctor.managedServer && lines.length > 0 && (
          <Collapse
            size="small"
            items={[{key: 'log', label: t('doctorServerLog'), children: <ServerLog lines={lines} />}]}
          />
        )}
      </Space>
    </Card>
  );
};

export default ServersCard;
