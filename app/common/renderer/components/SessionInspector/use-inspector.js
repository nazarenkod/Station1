import {bindActionCreators} from '@reduxjs/toolkit';
import {useCallback, useEffect, useMemo} from 'react';
import {shallowEqual, useDispatch, useSelector, useStore} from 'react-redux';
import {useNavigate} from 'react-router';

import * as A11yActions from '../../actions/A11y.js';
import * as SessionInspectorActions from '../../actions/SessionInspector.js';
import {offerSummary, summaryContext} from '../../lib/autotests/summary-store.js';

/**
 * The session actions, and quitting that returns to the session builder;
 * the screens of the session are offered for autotests then.
 */
export function useInspectorActions() {
  const dispatch = useDispatch();
  const store = useStore();
  const actions = useMemo(() => bindActionCreators({...SessionInspectorActions, ...A11yActions}, dispatch), [dispatch]);
  const navigate = useNavigate();
  const {quitSession} = actions;
  const quitSessionAndReturn = useCallback(
    async ({reason, manualQuit = true, detachOnly = false} = {}) => {
      const context = summaryContext(store.getState());
      await quitSession({reason, manualQuit, detachOnly});
      offerSummary(context);
      navigate('/session', {replace: true});
    },
    [navigate, quitSession, store],
  );
  return {actions, quitSessionAndReturn};
}

/**
 * The Appium session as the workstation's tools see it: the inspector state,
 * its actions, and the session set up done once, by whichever tool (Inspector
 * or A11y) opens it first. Switching between tools refreshes the source but
 * does not start the keep-alive loop again.
 */
export function useInspector() {
  const inspector = useSelector((state) => state.inspector, shallowEqual);
  const store = useStore();
  const {actions, quitSessionAndReturn} = useInspectorActions();
  const {driver} = inspector;

  useEffect(() => {
    if (!driver) {
      return;
    }
    actions.applyClientMethod({methodName: 'getPageSource'});
    if (store.getState().inspector.keepAliveInterval) {
      return;
    }
    actions.storeSessionSettings();
    actions.getSavedClientFramework();
    actions.runKeepAliveLoop();
    actions.setSessionTime(Date.now());
  }, [actions, store, driver]);

  const {screenshot, screenshotError, isUsingMjpegMode, isAwaitingMjpegStream, isSourceRefreshOn} = inspector;
  const showScreenshot =
    (screenshot && !screenshotError) || (isUsingMjpegMode && (!isSourceRefreshOn || !isAwaitingMjpegStream));

  return {props: {...inspector, ...actions}, quitSessionAndReturn, showScreenshot, hasSession: !!driver};
}
