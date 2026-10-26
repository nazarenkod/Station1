import {useEffect, useMemo, useRef} from 'react';
import {useDispatch, useSelector} from 'react-redux';

import {loadA11ySettings, runA11yScan} from '../../actions/A11y.js';
import {a11yScore, problemsForScore, visibleIssues} from '../SessionInspector/A11yTab/a11y-ui.js';
import {recordScreen} from './screen-history.js';

/**
 * Checks every screen the session shows and notes it in the session's
 * history, whichever tab of the Inspector is open.
 */
export function useScreenRecorder() {
  const dispatch = useDispatch();
  const inspector = useSelector((state) => state.inspector);
  const {sourceXML, screenshot, driver, a11yStatus, a11yScan, a11yScreen} = inspector;
  const {a11yDevice, a11yIssues, a11yFilter, a11yAi, a11yConfig} = inspector;
  const recorded = useRef(null);

  useEffect(() => {
    if (driver) {
      dispatch(loadA11ySettings());
    }
  }, [dispatch, driver]);

  useEffect(() => {
    if (sourceXML && driver) {
      dispatch(runA11yScan());
    }
  }, [dispatch, sourceXML, screenshot, driver]);

  const {reviewed} = useMemo(
    () => visibleIssues({a11yScan, a11yScreen, a11yDevice, a11yIssues, a11yFilter, a11yAi, a11yConfig}),
    [a11yScan, a11yScreen, a11yDevice, a11yIssues, a11yFilter, a11yAi, a11yConfig],
  );

  useEffect(() => {
    if (a11yStatus !== 'done' || !reviewed || !a11yScan || recorded.current === a11yScan) {
      return;
    }
    recorded.current = a11yScan;
    const counts = (reviewed.open ?? []).reduce((acc, v) => ({...acc, [v.severity]: (acc[v.severity] ?? 0) + 1}), {
      error: 0,
      warning: 0,
      info: 0,
    });
    recordScreen({
      sessionId: driver?.sessionId,
      screen: a11yScreen,
      sourceXML,
      screenshot,
      score: a11yScore(problemsForScore(reviewed)),
      counts,
    });
  }, [a11yStatus, a11yScan, reviewed, a11yScreen, sourceXML, screenshot, driver]);
}
