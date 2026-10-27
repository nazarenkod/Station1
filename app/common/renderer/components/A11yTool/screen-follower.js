import {useEffect, useRef, useState} from 'react';
import {useDispatch, useStore} from 'react-redux';

import {refreshA11yScreen} from '../../actions/A11y.js';
import {followDelay} from './screen-flow.js';
import {screenHistory} from './screen-history.js';
import {CHANGED, screenSignature, signatureDistance} from './screen-signature.js';

/**
 * Follows the device while the Inspector is open: a screenshot is compared
 * with the one checked last, every half a second right after the Inspector
 * acted on the device and every 1.5 s otherwise. Once the screen has changed
 * and stopped moving (two looks alike), the new screen is read and checked.
 * Nothing is read while the page is hidden (unless `whileHidden`: the app is
 * being measured while the person works on the device), a command runs, or a
 * past screen is shown.
 */
export function useScreenFollower({enabled, paused, whileHidden = false}) {
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
      if (
        busy.current ||
        (document.hidden && !whileHidden) ||
        !driver ||
        methodCallInProgress ||
        a11yStatus === 'scanning'
      ) {
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

    let timer = null;
    let stopped = false;
    const loop = async () => {
      await tick();
      if (!stopped) {
        timer = setTimeout(loop, followDelay({lastActionAt: screenHistory().lastAction?.at, now: Date.now()}));
      }
    };
    timer = setTimeout(loop, followDelay({lastActionAt: screenHistory().lastAction?.at, now: Date.now()}));
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, paused, whileHidden, store, dispatch]);

  return state;
}
