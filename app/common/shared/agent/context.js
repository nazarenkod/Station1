// What goes with each message so the agent need not guess what "this" is:
// the tab, the device and app, the profile, the task and what is selected,
// as ids and short names only. The agent fetches the rest with the station
// tools, as much as it needs.

export const CHIP_KINDS = [
  'tab',
  'device',
  'app',
  'profile',
  'task',
  'screen',
  'element',
  'request',
  'log',
  'finding',
  'notes',
];

const MAX_LABEL = 80;

const short = (value) => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
};

/**
 * A chip of the reference: what it is, its id for the tools, and a name.
 * @returns {{kind: string, id: string, label: string} | null}
 */
export function chip(kind, id, label) {
  if (!CHIP_KINDS.includes(kind) || (!id && !label)) {
    return null;
  }
  return {kind, id: String(id ?? ''), label: short(label ?? id)};
}

/** The reference block, one line a chip; empty when there is nothing to say. */
export function referenceBlock(chips = []) {
  const lines = chips
    .filter(Boolean)
    .map((one) => `- ${one.kind}: ${one.label}${one.id && one.id !== one.label ? ` (id: ${one.id})` : ''}`);
  if (!lines.length) {
    return '';
  }
  return [
    '<station-context>',
    'Where the user is in the station now. Fetch details with the station tools only when you need them.',
    ...lines,
    '</station-context>',
  ].join('\n');
}

/**
 * The prompt of one message for ACP: the reference first, then what the
 * person wrote.
 */
export function promptBlocks(message, chips = []) {
  const reference = referenceBlock(chips);
  return [...(reference ? [{type: 'text', text: reference}] : []), {type: 'text', text: String(message ?? '')}];
}

/** What would be sent to the agent, for the consent: by kind, never the values. */
export const CONSENT_PARTS = ['task', 'code', 'traffic', 'logs', 'screens', 'memory'];
