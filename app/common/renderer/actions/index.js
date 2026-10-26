import * as buildsActions from './Builds.js';
import * as sessionBuilderActions from './SessionBuilder.js';
import * as sessionInspectorActions from './SessionInspector.js';
import * as workstationActions from './Workstation.js';

export default {
  ...sessionInspectorActions,
  ...sessionBuilderActions,
  ...workstationActions,
  ...buildsActions,
};
