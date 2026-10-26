import {useEffect, useRef, useState} from 'react';
import {useDispatch, useStore} from 'react-redux';

import {refreshA11yScreen} from '../../actions/A11y.js';
import {CHANGED, screenSignature, signatureDistance} from './screen-signature.js';

const INTERVAL_MS = 2000;

/**
 * Follows the device while the A11y tool is open: every two seconds a
 * screenshot is compared with the one checked last, and once the screen has
 * changed and stopped moving, the new screen is read and checked. Nothing is
 * read while the page is hidden, a command runs, or a past screen is shown.
 */
export function useScreenFollower({enabled, paused}) {
  const store = useStore();
  const dispatch = useDispatch();
  const [state, setState] = useState({status: 'idle', changedAt: null});
  const known = useRef({screenshot: null, signature: null});
  const pending = useRef(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!enabled || paused) {
      pending.current = null;
      setState((current) => ({...current, status: 'idle'}));
      return undefined;
    }
    setState((current) => ({...current, status: 'watching'}));

    const tick = async () => {
      const {driver, screenshot, methodCallInProgress, a11yStatus} = store.getState().inspector;
      if (busy.current || document.hidden || !driver || methodCallInProgress || a11yStatus === 'scanning') {
        return;
      }
      busy.current = true;
      try {
        if (screenshot && known.current.screenshot !== screenshot) {
          known.current = {screenshot, signature: await screenSignature(screenshot)};
        }
        const now = await screenSignature(await driver.takeScreenshot());
        if (signatureDistance(now, known.current.signature) < CHANGED) {
          pending.current = null;
          return;
        }
        // still moving (a transition, a list scrolling): look again on the next tick
        if (!pending.current || signatureDistance(now, pending.current) >= CHANGED) {
          pending.current = now;
          return;
        }
        pending.current = null;
        setState({status: 'reading', changedAt: Date.now()});
        await dispatch(refreshA11yScreen());
        setState((current) => ({...current, status: 'watching'}));
      } catch {
        // a screenshot can fail mid-transition or while the session ends: the next tick tries again
      } finally {
        busy.current = false;
      }
    };

    const timer = setInterval(tick, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, paused, store, dispatch]);

  return state;
}
