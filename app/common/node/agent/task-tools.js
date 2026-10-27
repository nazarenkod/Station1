import {z} from 'zod';

import {cleanGoal, FIELD_OPS, FIELD_PLACES, GOAL_TYPES, goalProblem} from '../../shared/agent/goals.js';
import {TASK_PARTS, taskForAgent} from '../../shared/task/for-agent.js';

// The task tools of the agent: the context of the task that is on, by parts,
// and the impact analysis handed back as a checklist. Neither changes how the
// station works, so the station lets them run without asking: one reads, the
// other only keeps what the agent found for the person to see.

const evidence = z
  .array(
    z.object({
      file: z.string().optional(),
      lines: z.string().optional().describe('"120-134"'),
      commit: z.string().optional(),
      mr: z.string().optional().describe('URL of the merge request'),
      note: z.string().optional(),
    }),
  )
  .describe('Where this comes from: file and lines of the diff, a commit, or a usage site');

const item = z.object({
  text: z.string().describe('A short check, no explanation: screen or flow, action, expected result, request or field'),
  important: z.boolean().optional(),
  why: z.string().optional().describe('One or two sentences, shown on demand'),
  evidence,
});

/**
 * @param {object} deps
 * @param {() => Promise<{profileId: string, key: string | null}>} deps.current the task that is on
 * @param {ReturnType<import('../task/store.js').createTaskStore>} deps.store
 * @param {(conversation: string) => number} deps.turnOf
 * @param {(change: {profileId: string, key: string}) => void} deps.onChanged
 * @param {(proposal: object) => void} [deps.proposeGoal] a goal card for the person
 */
export function taskTools(deps) {
  const context = async () => {
    const {profileId, key} = await deps.current();
    if (!key) {
      return {profileId, key: null, data: null};
    }
    return {profileId, key, data: await deps.store.load(profileId, key)};
  };

  return [
    {
      name: 'task_context',
      readOnly: true,
      limit: 20000,
      description:
        'The task the engineer works on: an outline first; then a part in full: task (description, comments), linked (development task and others), pages (Confluence), mrs (merge requests with changed files), commits, impact (the saved checklist).',
      input: {part: z.enum(TASK_PARTS).optional()},
      run: async ({part}) => {
        const {key, data} = await context();
        if (!key) {
          return 'No task is chosen: the engineer picks one on the desk.';
        }
        if (!data?.context) {
          return `Task ${key} is chosen but its context is not loaded yet; ask the engineer to refresh it on the desk.`;
        }
        return taskForAgent({...data.context, impact: data.impact}, part ?? 'outline');
      },
    },
    {
      name: 'impact_report',
      readOnly: false,
      autoAllow: true,
      description:
        'Hands the impact analysis of the task to the station as a checklist. check: what to check in the task’s changes; regress: what outside the task could regress. Every item needs evidence; general advice and repeats are left out. empty: one line for a section with nothing real at risk.',
      input: {
        check: z.array(item).optional(),
        regress: z.array(item).optional(),
        empty: z.object({check: z.string().optional(), regress: z.string().optional()}).optional(),
      },
      run: async (report, {conversation}) => {
        const {profileId, key} = await context();
        if (!key) {
          return 'Not saved: no task is chosen.';
        }
        const result = await deps.store.saveImpact(profileId, key, report, {
          conversation,
          turn: deps.turnOf(conversation),
        });
        if (!result.ok) {
          return `Not saved: ${result.error}`;
        }
        deps.onChanged({profileId, key});
        const left = result.rejected.map((one) => `- "${one.text}": ${one.reason}`);
        return [
          `Saved for ${key}: ${result.counts.check} checks, ${result.counts.regress} regression risks.`,
          left.length
            ? `Left out ${left.length} (fix and send all items again if they matter):\n${left.join('\n')}`
            : null,
          'Now answer the engineer in one line with the counts; the checklist is shown on the task card.',
        ]
          .filter(Boolean)
          .join('\n');
      },
    },
    {
      name: 'goal_propose',
      readOnly: false,
      autoAllow: true,
      description:
        'Proposes a goal of the session: a check the station then counts by itself on live traffic, logs and screens. The engineer accepts it or not. type: request (method, path pattern), field (method, path, where, field JSON path or name, op exists|equals|matches|absent, value), status (method, path, status like "200" or "4xx"), log (pattern regex, level, tag, mode seen|notSeen), screen (screen title, state), noFlags (method, path: no errors there), manual. title: short, in the engineer’s language. itemId: the impact checklist item it checks.',
      input: {
        title: z.string(),
        type: z.enum(GOAL_TYPES),
        method: z.string().optional(),
        path: z.string().optional().describe('URL pattern, * for anything: "*/v2/transfers"'),
        where: z.enum(FIELD_PLACES).optional(),
        field: z.string().optional(),
        op: z.enum(FIELD_OPS).optional(),
        value: z.string().optional(),
        status: z.string().optional(),
        pattern: z.string().optional(),
        level: z.enum(['V', 'D', 'I', 'W', 'E', 'F']).optional(),
        tag: z.string().optional(),
        mode: z.enum(['seen', 'notSeen']).optional(),
        screen: z.string().optional(),
        state: z.string().optional(),
        expectOn: z.string().optional().describe('The screen where it should happen'),
        why: z.string().optional(),
        source: z.enum(['task', 'mr', 'code', 'impact']).optional(),
        itemId: z.string().optional(),
      },
      run: async ({title, type, expectOn, why, source, itemId, ...params}, {conversation}) => {
        const {key} = await context();
        const goal = cleanGoal({title, type, expectOn, why, source: source ?? 'agent', itemId, params});
        const problem = goalProblem(goal);
        if (problem) {
          return `Not proposed: ${problem} is missing or not valid for a ${type} goal.`;
        }
        deps.proposeGoal?.({conversation, goal, key});
        return 'Proposed to the engineer; it counts only if they accept it.';
      },
    },
  ];
}
