import {Splitter} from 'antd';
import {useRef, useState} from 'react';

import {WINDOW_DIMENSIONS} from '../../constants/common.js';
import {useScreenFollower} from '../A11yTool/screen-follower.js';
import {useScreenHistory} from '../A11yTool/screen-history.js';
import {useScreenRecorder} from '../A11yTool/screen-recorder.js';
import ScreenStrip from '../A11yTool/ScreenStrip.jsx';
import ToolBar from '../Workstation/ToolBar.jsx';
import HeaderButtons from './Header/HeaderButtons.jsx';
import Screenshot from './Screenshot/Screenshot.jsx';
import SessionInspectorTabs from './SessionInspectorTabs.jsx';
import {useInspector} from './use-inspector.js';

import styles from './SessionInspector.module.css';

const MAX_SCREENSHOT_WIDTH_PERCENT = `${WINDOW_DIMENSIONS.MAX_SCREENSHOT_PANEL_WIDTH_FRACTION * 100}%`;

// following the screen stays as chosen while the app runs
let followPreference = true;

/**
 * The Inspector: the running session's screen next to its elements, its
 * accessibility check, commands and recorder. It follows the device, so a
 * new screen is read and checked by itself, and keeps the screens the
 * session went through.
 */
const Inspector = () => {
  const {props, quitSessionAndReturn, showScreenshot, hasSession} = useInspector();
  const [follow, setFollow] = useState(followPreference);
  const {viewingKey} = useScreenHistory();
  const follower = useScreenFollower({enabled: hasSession && follow, paused: !!viewingKey});
  useScreenRecorder();

  const [screenshotPanelWidth, setScreenshotPanelWidth] = useState(WINDOW_DIMENSIONS.INITIAL_SCREENSHOT_PANEL_WIDTH_PX);
  const screenshotPanelResizedManually = useRef(false);

  // Triggered when the width of the scaled image or Inspector window changes.
  const setPanelWidthAutomatically = (suggestedWidth) => {
    setScreenshotPanelWidth((curWidth) => {
      if (screenshotPanelResizedManually.current) {
        // re-enforce the same limits that are already set for Splitter.Panel,
        // otherwise the panel can go outside these bounds upon Inspector window size change
        const maxPanelSize = window.innerWidth * WINDOW_DIMENSIONS.MAX_SCREENSHOT_PANEL_WIDTH_FRACTION;
        return Math.min(Math.max(curWidth, WINDOW_DIMENSIONS.MIN_IMG_WIDTH_PX), maxPanelSize);
      }
      // ignore sub-pixel differences to avoid a resizing loop
      return Math.abs(suggestedWidth - curWidth) < 1 ? curWidth : suggestedWidth;
    });
  };

  // Triggered when manually adjusting the splitter. Only needed to trip the manual resize flag.
  const setPanelWidthManually = (widths) => {
    screenshotPanelResizedManually.current = true;
    setScreenshotPanelWidth(widths[0]);
  };

  return (
    <div className={styles.inspectorContainer}>
      <ToolBar>
        <HeaderButtons {...props} quitSessionAndReturn={quitSessionAndReturn} />
      </ToolBar>
      <div className={styles.screenStrip}>
        <ScreenStrip
          follow={follow}
          follower={follower}
          onFollowChange={(value) => {
            followPreference = value;
            setFollow(value);
          }}
        />
      </div>
      <Splitter className={styles.inspectorSplitter} onResize={setPanelWidthManually}>
        <Splitter.Panel
          min={WINDOW_DIMENSIONS.MIN_IMG_WIDTH_PX}
          max={MAX_SCREENSHOT_WIDTH_PERCENT}
          size={screenshotPanelWidth}
        >
          <Screenshot
            {...props}
            showScreenshot={showScreenshot}
            screenshotPanelWidth={screenshotPanelWidth}
            suggestScreenshotPanelWidth={setPanelWidthAutomatically}
          />
        </Splitter.Panel>
        <Splitter.Panel>
          <SessionInspectorTabs {...props} showScreenshot={showScreenshot} />
        </Splitter.Panel>
      </Splitter>
    </div>
  );
};

export default Inspector;
