import {goalsStatus} from '../../shared/agent/hands.js';

// What the agent reads besides the screen when it goes through a flow by
// itself: where the goals of the session stand, and the builds it may put on
// the device.

/**
 * @param {object} deps
 * @param {(kind: string, args?: object) => Promise<any>} deps.ask the window: `goals`
 * @param {() => Promise<object[]>} deps.builds the builds of the project's app the station knows
 */
export function handsTools(deps) {
  return [
    {
      name: 'goals_status',
      readOnly: true,
      description:
        'Where the goals of this session stand: failed, pending, manual, holding, passed, with the screen each is expected on and what proved it. Look after each flow to know where to go next.',
      input: {},
      run: async () => {
        const {goals = [], states = {}} = (await deps.ask('goals').catch(() => null)) ?? {};
        return goalsStatus(goals, states);
      },
    },
    {
      name: 'builds_list',
      readOnly: true,
      description:
        "The builds of the project's app the station knows (opened from a file or a pipeline), newest first: version, build and file. Install one with appium_app_lifecycle action=install and its file as path.",
      input: {},
      run: async () => {
        const builds = await deps.builds();
        if (!builds.length) {
          return 'No builds of this app yet: the user opens one in the Builds tab.';
        }
        return builds
          .slice(0, 10)
          .map((build) => `- ${build.version ?? '?'} (${build.build ?? '?'}), ${build.source ?? 'file'}: ${build.file}`)
          .join('\n');
      },
    },
  ];
}
