// The next steps the operator offers at the end of an answer: a block of its
// own lines, `<next-steps>` with «label :: message» lines, that the chat turns
// into buttons. In the text, not through a tool: a tool at the end of an
// answer makes Kiro ask the model once more, which costs a round of credits.

export const MAX_STEPS = 4;
const OPEN = '<next-steps>';
const CLOSE = '</next-steps>';

/** Steps as the chat shows them: a short label and a message, each label once. */
export function cleanSteps(steps) {
  const seen = new Set();
  return (Array.isArray(steps) ? steps : [])
    .map((step) => ({
      label: String(step?.label ?? '')
        .trim()
        .slice(0, 48),
      message: String(step?.message ?? '')
        .trim()
        .slice(0, 600),
    }))
    .filter((step) => step.label && step.message && !seen.has(step.label) && seen.add(step.label))
    .slice(0, MAX_STEPS);
}

/**
 * The text of an answer without its block of next steps, and the steps.
 * A block still streaming is hidden as it comes.
 * @returns {{text: string, steps: {label: string, message: string}[]}}
 */
export function splitNextSteps(text) {
  const source = String(text ?? '');
  const start = source.lastIndexOf(OPEN);
  if (start < 0) {
    return {text: source, steps: []};
  }
  const end = source.indexOf(CLOSE, start);
  const body = source.slice(start + OPEN.length, end < 0 ? undefined : end);
  const steps = cleanSteps(
    body
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
      .filter(Boolean)
      .map((line) => {
        const [label, ...rest] = line.split('::');
        return {label, message: rest.join('::').trim() || label};
      }),
  );
  const after = end < 0 ? '' : source.slice(end + CLOSE.length);
  return {text: `${source.slice(0, start)}${after}`.trimEnd(), steps};
}

// a list item that starts with a choice in bold: "- **Allow the run.** It only reads…"
const CHOICE = /^\s*(?:[-*]|\d+[.)])\s+\*\*(.+?)\*\*/;

/**
 * The choices of an answer that ends with a question and lists them in bold,
 * when the operator forgot the block: each becomes a step that sends its
 * name. Two to four of them, or none.
 */
export function choiceSteps(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (!lines.at(-1)?.trim().endsWith('?')) {
    return [];
  }
  const steps = cleanSteps(
    lines
      .map((line) =>
        CHOICE.exec(line)?.[1]
          .replace(/[.:,;!]+$/, '')
          .trim(),
      )
      .filter(Boolean)
      .map((label) => ({label, message: label})),
  );
  return steps.length >= 2 ? steps : [];
}

/** The steps an answer offers: its block, else the choices it asks between. */
export function stepsOf(text) {
  const {steps} = splitNextSteps(text);
  return steps.length ? steps : choiceSteps(text);
}
