import {IconAccessible, IconFocus2} from '@tabler/icons-react';
import {Button, Splitter} from 'antd';
import {useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router';

import {WINDOW_DIMENSIONS} from '../../constants/common.js';
import A11yTab from '../SessionInspector/A11yTab/A11yTab.jsx';
import Screenshot from '../SessionInspector/Screenshot/Screenshot.jsx';
import {useInspector} from '../SessionInspector/use-inspector.js';
import EmptyState from '../Workstation/EmptyState.jsx';

import inspectorStyles from '../SessionInspector/SessionInspector.module.css';
import styles from './A11yTool.module.css';

const MAX_SCREENSHOT_WIDTH_PERCENT = `${WINDOW_DIMENSIONS.MAX_SCREENSHOT_PANEL_WIDTH_FRACTION * 100}%`;

/**
 * Without a session there is no screen to check: a way to start one.
 */
const NoSession = () => {
  const {t} = useTranslation();
  const navigate = useNavigate();
  return (
    <EmptyState
      tool="a11y"
      icon={IconAccessible}
      title={t('a11yToolNoSessionTitle')}
      text={t('a11yToolNoSessionText')}
      steps={[t('a11yToolStep1'), t('a11yToolStep2'), t('a11yToolStep3')]}
      actions={
        <Button type="primary" icon={<IconFocus2 size={16} />} onClick={() => navigate('/session')}>
          {t('a11yToolStartSession')}
        </Button>
      }
    />
  );
};

/**
 * The accessibility tool: the screen of the running session next to the
 * audit, its problems and their bugs in Jira.
 */
const A11yTool = () => {
  const {props, showScreenshot, hasSession} = useInspector();
  const [panelWidth, setPanelWidth] = useState(WINDOW_DIMENSIONS.INITIAL_SCREENSHOT_PANEL_WIDTH_PX);
  const resizedManually = useRef(false);

  if (!hasSession) {
    return <NoSession />;
  }

  const suggestWidth = (suggested) =>
    setPanelWidth((current) => {
      if (resizedManually.current) {
        const max = window.innerWidth * WINDOW_DIMENSIONS.MAX_SCREENSHOT_PANEL_WIDTH_FRACTION;
        return Math.min(Math.max(current, WINDOW_DIMENSIONS.MIN_IMG_WIDTH_PX), max);
      }
      return Math.abs(suggested - current) < 1 ? current : suggested;
    });

  return (
    <div className={styles.tool}>
      <Splitter
        className={inspectorStyles.inspectorSplitter}
        onResize={(widths) => {
          resizedManually.current = true;
          setPanelWidth(widths[0]);
        }}
      >
        <Splitter.Panel min={WINDOW_DIMENSIONS.MIN_IMG_WIDTH_PX} max={MAX_SCREENSHOT_WIDTH_PERCENT} size={panelWidth}>
          <Screenshot
            {...props}
            showScreenshot={showScreenshot}
            screenshotPanelWidth={panelWidth}
            suggestScreenshotPanelWidth={suggestWidth}
          />
        </Splitter.Panel>
        <Splitter.Panel>
          <div className={styles.audit}>
            <A11yTab {...props} />
          </div>
        </Splitter.Panel>
      </Splitter>
    </div>
  );
};

export default A11yTool;
