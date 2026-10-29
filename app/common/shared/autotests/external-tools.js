// The tools an agent outside the station (the test agent) has: reading the
// packages of screen objects, nothing else. The bridge (`vision-inspector
// mcp`) describes them to the agent; the station runs them. `input` takes zod,
// so this file needs nothing of its own.

export const EXTERNAL_TOOLS = [
  {
    name: 'autotests_packages',
    title: 'Packages of screen objects',
    description:
      'Lists the packages of screen objects saved in the mobile testing station after a session: name, date, platform, app version, how many screen objects, how many have code, whether a person marked the package ready for autotests. Without details.',
    input: (z) => ({
      project: z.string().optional().describe('Project name in the station; the active project when omitted'),
    }),
  },
  {
    name: 'autotests_package_get',
    title: 'Screen objects of a package',
    description:
      'The screen objects of a package: name, screen, states and the generated Kotlin code (Appium + Selenide). Every element with its locators and actions only when asked with `elements`; the reduced screenshots of the states only when asked with `screenshots`.',
    input: (z) => ({
      package: z.string().describe('Package id or name from autotests_packages'),
      project: z.string().optional().describe('Project name; the active project when omitted'),
      screen_object: z.string().optional().describe('Only this screen object (its name)'),
      elements: z.boolean().optional().describe('Add every element with its locators and actions'),
      screenshots: z.boolean().optional().describe('Add the reduced screenshot of each state'),
    }),
  },
];

export const EXTERNAL_TOOL_NAMES = new Set(EXTERNAL_TOOLS.map((tool) => tool.name));

// past this an answer is cut, with a hint how to ask for less
export const EXTERNAL_LIMIT = 60000;

/** An answer cut to the limit, saying so. */
export function limitAnswer(text, limit = EXTERNAL_LIMIT) {
  return text.length > limit
    ? `${text.slice(0, limit)}\n… cut at ${limit} characters: ask for one screen_object at a time`
    : text;
}
