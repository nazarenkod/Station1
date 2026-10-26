import {combineReducers} from '@reduxjs/toolkit';

import builds from './Builds.js';
import builder from './SessionBuilder.js';
import inspector from './SessionInspector.js';
import workstation from './Workstation.js';

// create our root reducer
export default function createRootReducer() {
  return combineReducers({
    builder,
    builds,
    inspector,
    workstation,
  });
}
