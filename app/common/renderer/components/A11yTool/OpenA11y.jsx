import {useEffect} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {useNavigate} from 'react-router';

import {selectInspectorTab} from '../../actions/SessionInspector.js';
import {INSPECTOR_TABS} from '../../constants/session-inspector.js';

/**
 * The accessibility check lives in the Inspector: links to it open the
 * Inspector on its Accessibility tab, or the session start without a session.
 */
const OpenA11y = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const hasSession = useSelector((state) => !!state.inspector.driver);

  useEffect(() => {
    if (hasSession) {
      dispatch(selectInspectorTab(INSPECTOR_TABS.A11Y));
    }
    navigate(hasSession ? '/inspector' : '/session', {replace: true});
  }, [dispatch, navigate, hasSession]);

  return null;
};

export default OpenA11y;
