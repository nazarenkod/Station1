import {z} from 'zod';

import {checkNote, cleanNote, NOTE_KINDS, NOTE_SCOPES, notesForAgent, similarNote} from '../../shared/agent/memory.js';

// The memory tools of the agent: searching the notes, and proposing a new
// one. A proposal is only a card in the chat; the person saves it or not.

const tags = {
  screen: z.string().optional(),
  endpoint: z.string().optional().describe('"POST /v2/transfers"'),
  platform: z.enum(['android', 'ios']).optional(),
};

/**
 * @param {object} deps
 * @param {ReturnType<import('./memory-store.js').createMemoryStore>} deps.store
 * @param {(conversation: string, notes: object[]) => void} deps.onUsed
 * @param {(proposal: object) => void} deps.propose
 * @param {() => Promise<RegExp[]>} deps.masks
 */
export function memoryTools(deps) {
  return [
    {
      name: 'memory_search',
      readOnly: true,
      description:
        'Searches the memory: the engineer’s corrections, lessons about the app, preferences. Search before concluding about a screen, an endpoint or a finding. Up to 10 notes.',
      input: {query: z.string().optional(), ...tags},
      run: async ({query, ...wanted}, {conversation}) => {
        const notes = await deps.store.search(query ?? '', wanted);
        if (notes.length) {
          deps.onUsed(conversation, notes);
        }
        return notesForAgent(notes);
      },
    },
    {
      name: 'memory_propose',
      readOnly: false,
      autoAllow: true,
      description:
        'Proposes a note when the engineer corrects you or says "remember": one fact or rule, up to 300 characters. kind: correction, lesson or preference; scope: personal, project or task. The engineer saves it or not; never assume it is saved. replaces: the id of a note it should take the place of.',
      input: {
        kind: z.enum(NOTE_KINDS),
        text: z.string(),
        scope: z.enum(NOTE_SCOPES).optional(),
        replaces: z.string().optional(),
        ...tags,
      },
      run: async ({kind, text, scope, replaces, ...wanted}, {conversation}) => {
        const note = cleanNote({kind, text, scope: scope ?? 'project', tags: wanted});
        const checked = checkNote(note.text, await deps.masks());
        if (!checked.ok) {
          return `Not proposed: ${checked.reason === 'secret' ? 'it looks like a secret' : checked.reason === 'personal' ? 'it holds personal data' : 'it is empty'}. Say it without that.`;
        }
        const similar = replaces ? null : similarNote(note, await deps.store.all());
        deps.propose({conversation, note, replaces: replaces ?? null, similar});
        return `Proposed to the engineer${similar ? `; it is close to note ${similar.id}, the engineer chooses` : ''}. It is kept only if they save it.`;
      },
    },
  ];
}
