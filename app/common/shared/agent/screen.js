import {compileMasks, MASK, maskText} from './privacy.js';

// The screen as the agent reads it: the meaningful elements of the UI tree
// only, one line each, indented by depth. Layout containers without text, id
// or an action are left out; passwords and filled-in fields are hidden.

const MAX_LINES = 150;
const EDITABLE = /EditText|TextField|TextView$|SecureTextField|SearchField/;

const shortClass = (className) =>
  String(className ?? '')
    .split('.')
    .pop()
    .replace(/^XCUIElementType/, '');

const meaningful = (node) =>
  !!(node.text?.trim() || node.label?.trim() || node.resourceId || node.hint?.trim() || node.clickable);

/**
 * @param {{nodes: object[]}} tree a parsed UI tree
 * @returns {{lines: string[], total: number, shown: number}}
 */
export function compactTree(tree, {masks = compileMasks(), maxLines = MAX_LINES} = {}) {
  const nodes = (tree?.nodes ?? []).filter((node) => node.visible !== false && meaningful(node));
  const lines = nodes.slice(0, maxLines).map((node) => {
    const hidden =
      node.password ||
      (EDITABLE.test(node.className) && node.text?.trim() && node.className !== 'android.widget.TextView');
    const text = hidden ? MASK : maskText(node.text?.trim() ?? '', masks);
    const parts = [
      '  '.repeat(Math.min(node.depth ?? 0, 12)) + shortClass(node.className),
      text ? `"${text.slice(0, 80)}"` : '',
      node.label?.trim() && node.label.trim() !== node.text?.trim()
        ? `label="${maskText(node.label.trim(), masks).slice(0, 80)}"`
        : '',
      node.resourceId ? `id=${String(node.resourceId).split('/').pop()}` : '',
      node.hint?.trim() ? `hint="${node.hint.trim().slice(0, 40)}"` : '',
      node.clickable ? '[tap]' : '',
      node.enabled === false ? '[disabled]' : '',
      node.checked ? '[checked]' : '',
      node.selected ? '[selected]' : '',
    ];
    return parts.filter(Boolean).join(' ');
  });
  return {lines, total: nodes.length, shown: lines.length};
}

/** The flow of the session for the agent: screens with their states, the path. */
export function compactFlow(flow) {
  const screens = (flow?.screens ?? []).map((screen) => ({
    key: screen.key,
    title: screen.title ?? '(unnamed)',
    visits: screen.visits,
    states: (screen.states ?? []).map((state) => state.title ?? `state ${state.number}`),
  }));
  const titleOf = (key) => flow?.screens?.find((screen) => screen.key === key)?.title ?? '(unnamed)';
  const path = (flow?.path ?? []).map(
    (step) =>
      `${titleOf(step.key)}${step.repeat > 1 ? ` ×${step.repeat}` : ''}${step.action ? ` (after ${step.action.kind ?? step.action})` : ''}`,
  );
  return {screens, path: path.slice(-40), earlierSteps: (flow?.pathDropped ?? 0) + Math.max(0, path.length - 40)};
}
