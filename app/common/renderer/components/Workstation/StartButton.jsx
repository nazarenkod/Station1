import {IconPlayerPlay} from '@tabler/icons-react';
import {App, Button, Tooltip} from 'antd';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {activeDevice, isDeviceRunning, noteSessionDevice} from '../../actions/Workstation.js';
import {startEverything} from '../../lib/session/start-all.js';
import {backend} from '../../polyfills.js';

const STAGE_TEXT = {tools: 'wsStartingTools', server: 'quickStartingServer', session: 'quickStarting'};

/**
 * «Start session» in the title bar while there is none: the proxy, the log,
 * the measurement and the session at once, then the UI Inspector.
 */
const StartButton = () => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const {message} = App.useApp();
  const workstation = useSelector((state) => state.workstation);
  const hasSession = useSelector((state) => !!state.inspector.driver);
  const device = activeDevice(workstation);
  const [stage, setStage] = useState(null);

  if (hasSession || !backend.doctor) {
    return null;
  }
  const ready = isDeviceRunning(device);

  const start = async () => {
    try {
      const result = await startEverything({
        dispatch,
        device,
        app: workstation.app,
        appium: workstation.appium,
        onStage: setStage,
      });
      if (result.error) {
        message.error(t(result.error.key, result.error.params));
      } else if (!result.refused) {
        dispatch(noteSessionDevice(device.id));
        navigate('/inspector');
      }
    } finally {
      setStage(null);
    }
  };

  return (
    <Tooltip title={ready ? t('wsStartAllHint') : t('wsStartNoDevice')}>
      <Button type="primary" icon={<IconPlayerPlay size={15} />} loading={!!stage} disabled={!ready} onClick={start}>
        {stage ? t(STAGE_TEXT[stage]) : t('startSession')}
      </Button>
    </Tooltip>
  );
};

export default StartButton;
