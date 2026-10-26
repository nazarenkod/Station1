import {
  SET_BUILD,
  SET_BUILD_INSTALL,
  SET_BUILDS_HISTORY,
  SET_GITLAB_BUILDS,
  SET_GITLAB_FETCH,
} from '../actions/Builds.js';

// the build being looked at, its install, and where builds come from
const INITIAL_STATE = {
  current: {status: 'idle'},
  install: {status: 'idle'},
  history: [],
  gitlab: {status: 'idle', builds: []},
  fetch: {status: 'idle'},
};

export default function builds(state = INITIAL_STATE, action) {
  switch (action.type) {
    case SET_BUILD:
      return {...state, current: action.current};
    case SET_BUILD_INSTALL:
      return {...state, install: action.install};
    case SET_BUILDS_HISTORY:
      return {...state, history: action.history};
    case SET_GITLAB_BUILDS:
      return {...state, gitlab: action.gitlab};
    case SET_GITLAB_FETCH:
      return {...state, fetch: action.fetch};
    default:
      return state;
  }
}
