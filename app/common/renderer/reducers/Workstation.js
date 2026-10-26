import {
  RESTORE_WORKSTATION,
  SET_WORKSTATION_APP,
  SET_WORKSTATION_APPIUM,
  SET_WORKSTATION_APPS,
  SET_WORKSTATION_DEVICE,
  SET_WORKSTATION_DEVICES,
  SET_WORKSTATION_DEVICES_LOADING,
  SET_WORKSTATION_MY_BUGS,
} from '../actions/Workstation.js';

// what every tool of the workstation shares: the device, the app and the services around them
const INITIAL_STATE = {
  devices: [],
  devicesLoaded: false,
  devicesLoading: false,
  deviceId: null,
  apps: [],
  appsLoading: false,
  // why the apps of the device could not be read (an Xcode too old for the iPhone, a locked phone)
  appsError: null,
  app: null,
  recentApps: [],
  // the app last used on each device, by device id
  appByDevice: {},
  appium: {status: 'stopped'},
  myBugs: {status: 'idle', issues: []},
};

export default function workstation(state = INITIAL_STATE, action) {
  switch (action.type) {
    case RESTORE_WORKSTATION:
      return {
        ...state,
        deviceId: action.deviceId,
        app: action.app,
        recentApps: action.recentApps,
        appByDevice: action.appByDevice ?? {},
      };
    case SET_WORKSTATION_DEVICES_LOADING:
      // a background poll does not spin the refresh buttons
      return {...state, devicesLoading: action.loading, devicesPolling: !!action.quiet && action.loading};
    case SET_WORKSTATION_DEVICES:
      return {...state, devices: action.devices, devicesLoaded: true, devicesLoading: false, devicesPolling: false};
    case SET_WORKSTATION_DEVICE:
      return {
        ...state,
        deviceId: action.deviceId,
        appByDevice: action.appByDevice ?? state.appByDevice,
        apps: [],
        appsError: null,
      };
    case SET_WORKSTATION_APPS:
      return {...state, apps: action.apps, appsLoading: action.loading, appsError: action.error ?? null};
    case SET_WORKSTATION_APP:
      return {
        ...state,
        app: action.app,
        recentApps: action.recentApps,
        appByDevice: action.appByDevice ?? state.appByDevice,
      };
    case SET_WORKSTATION_APPIUM:
      return {...state, appium: action.appium ?? {status: 'stopped'}};
    case SET_WORKSTATION_MY_BUGS:
      return {...state, myBugs: action.myBugs};
    default:
      return state;
  }
}
