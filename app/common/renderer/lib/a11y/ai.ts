// What Vision Inspector asks a vision model about a screen, and how its answers
// become issues. The label prompt is vision's (ai-features.service.ts#suggestLabels).

import type {A11ySeverity, A11yViolation} from './types';
import {ownSpeakableText} from './ui-tree';
import type {Rect, UiNode, UiTree} from './ui-tree.types';

export const AI_KINDS = [
  'ai-label-mismatch',
  'ai-vague-text',
  'ai-color-only',
  'ai-text-in-image',
  'ai-missing-heading',
  'ai-affordance',
] as const;

export type AiKind = (typeof AI_KINDS)[number];

const LANGUAGE_NAMES: Record<string, string> = {en: 'English', uk: 'Ukrainian'};
// at most this many elements go into the prompt, the visible ones on top first
const MAX_ELEMENTS = 120;
const CONFIDENT = 0.75;

export interface AiElement {
  n: number;
  type: string;
  text?: string;
  label?: string;
  id?: string;
  clickable?: boolean;
  // position on screen in percent: x, y, width, height
  box: [number, number, number, number];
}

const shortClass = (className: string) => (className.split('.').pop() ?? className).replace('XCUIElementType', '');
const pct = (value: number, total: number) => Math.round((value / Math.max(1, total)) * 1000) / 10;

/**
 * The elements worth showing the model: on screen, visible, with something to
 * say or to tap. Texts matching the mask patterns are replaced.
 */
export function aiElements(
  tree: UiTree,
  mask: (text: string) => string = (text) => text,
): {
  elements: AiElement[];
  nodes: UiNode[];
} {
  const nodes = tree.nodes
    .filter(
      (node) =>
        node.visible &&
        node.bounds.width > 0 &&
        node.bounds.height > 0 &&
        node.bounds.y < tree.height &&
        (node.clickable || ownSpeakableText(node) || /Image/.test(node.className)),
    )
    .slice(0, MAX_ELEMENTS);
  const elements = nodes.map((node, index) => ({
    n: index + 1,
    type: shortClass(node.className),
    ...(node.text ? {text: mask(node.text).slice(0, 80)} : {}),
    ...(node.label && node.label !== node.text ? {label: mask(node.label).slice(0, 80)} : {}),
    ...(node.resourceId ? {id: node.resourceId.replace(/^.*:id\//, '')} : {}),
    ...(node.clickable ? {clickable: true} : {}),
    box: [
      pct(node.bounds.x, tree.width),
      pct(node.bounds.y, tree.height),
      pct(node.bounds.width, tree.width),
      pct(node.bounds.height, tree.height),
    ] as [number, number, number, number],
  }));
  return {elements, nodes};
}

/**
 * Asks for what rules on the tree cannot see: whether a label matches its
 * icon, whether button texts make sense on their own, colour-only meaning,
 * text baked into images, headings, and controls that look other than they act.
 */
export function auditPrompt(elements: AiElement[], language: string, platform: 'android' | 'ios'): string {
  const reader = platform === 'ios' ? 'VoiceOver' : 'TalkBack';
  return [
    `You are an accessibility auditor for a mobile app (${platform}). The image is a screenshot; some private values on it are blacked out on purpose.`,
    `These are the screen's elements as ${reader} sees them (n, type, text, label = what is announced, id, clickable, box = x, y, width, height in % of the screen):`,
    JSON.stringify(elements),
    'Report only real problems a screen reader user or a low-vision user would hit that these checks cannot get from the element list alone:',
    '- ai-label-mismatch: the announced label does not match what the element shows or does (a trash icon labelled "Settings").',
    '- ai-vague-text: a button or link text that means nothing out of context ("Click here", "More" repeated for different things).',
    '- ai-color-only: information given only by colour (an error shown just by a red border, status only by a coloured dot).',
    '- ai-text-in-image: meaningful text drawn inside an image that is not in any label or text.',
    '- ai-missing-heading: a visual section title or screen title that would need to be a heading for navigation.',
    '- ai-affordance: something that looks tappable but is not clickable, or the reverse.',
    'Do not report contrast, sizes, missing labels or anything the element list already shows; those are checked elsewhere. Do not guess: skip what you are not sure about.',
    `Write title, message and fix in ${LANGUAGE_NAMES[language] ?? 'English'}; title up to 6 words, message one sentence naming the element by its text or what it shows (never by its number n), fix one sentence.`,
    'Answer in JSON: {"issues": [{"kind": "ai-…", "element": n or null, "box": [x, y, w, h] in % if no element fits, "title": "", "message": "", "fix": "", "confidence": 0..1}]}. An empty list is a fine answer.',
  ].join('\n');
}

const toRect = (box: unknown, tree: UiTree): Rect | null => {
  if (!Array.isArray(box) || box.length !== 4 || box.some((value) => typeof value !== 'number')) {
    return null;
  }
  const [x, y, width, height] = box as number[];
  return {
    x: Math.round((x / 100) * tree.width),
    y: Math.round((y / 100) * tree.height),
    width: Math.round((width / 100) * tree.width),
    height: Math.round((height / 100) * tree.height),
  };
};

/**
 * The model's answer as issues next to the rules' ones. Answers about unknown
 * kinds or elements are dropped; unsure ones become advice.
 */
export function parseAuditAnswer(answer: unknown, tree: UiTree, nodes: UiNode[]): A11yViolation[] {
  const issues = (answer as {issues?: unknown[]})?.issues;
  if (!Array.isArray(issues)) {
    return [];
  }
  const result: A11yViolation[] = [];
  for (const raw of issues) {
    const issue = raw as Record<string, unknown>;
    if (
      !AI_KINDS.includes(issue.kind as AiKind) ||
      typeof issue.title !== 'string' ||
      typeof issue.message !== 'string'
    ) {
      continue;
    }
    const node = typeof issue.element === 'number' ? nodes[issue.element - 1] : undefined;
    const bounds = node?.bounds ?? toRect(issue.box, tree);
    if (!bounds) {
      continue;
    }
    const confidence = typeof issue.confidence === 'number' ? issue.confidence : 0.5;
    const severity: A11ySeverity = confidence >= CONFIDENT ? 'warning' : 'info';
    const where = node?.key ?? `box:${bounds.x},${bounds.y}`;
    result.push({
      id: `${issue.kind}|${where}`,
      rule: issue.kind as A11yViolation['rule'],
      severity,
      title: issue.title.slice(0, 80),
      message: issue.message.slice(0, 300),
      nodeKey: node?.key ?? where,
      resourceId: node?.resourceId ?? '',
      className: node?.className ?? '',
      label: node ? ownSpeakableText(node) : '',
      bounds,
      ...(node?.elementPath !== undefined ? {elementPath: node.elementPath} : {}),
      details: {
        ...(typeof issue.fix === 'string' ? {fix: issue.fix.slice(0, 300)} : {}),
        confidence: Math.round(confidence * 100) / 100,
      },
      source: 'ai',
    });
  }
  // one entry per id, the most confident wins
  return [
    ...new Map(
      result.sort((a, b) => Number(a.details?.confidence) - Number(b.details?.confidence)).map((v) => [v.id, v]),
    ).values(),
  ];
}

/**
 * vision's prompt for labels of unlabeled controls, from small crops of each.
 */
export function labelsPrompt(count: number, screenTexts: string[]): string {
  return [
    `Each of these ${count} images is a control from a mobile app screen with no accessibility label.`,
    screenTexts.length
      ? `Other texts on the screen: ${screenTexts.map((text) => `"${text.slice(0, 40)}"`).join(', ')}.`
      : '',
    'For each image, in order, propose a short label (1–4 words) naming its action, in the same language as',
    'the screen texts. Never include words like "button" or "icon".',
    'Reply in JSON: {"labels": [{"index": 1, "label": "..."}]}, index starting at 1.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function parseLabelsAnswer(answer: unknown, violations: A11yViolation[]): Record<string, string> {
  const labels = (answer as {labels?: Array<{index?: unknown; label?: unknown}>})?.labels;
  if (!Array.isArray(labels)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const item of labels) {
    const index = Number(item.index);
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (index >= 1 && index <= violations.length && label) {
      result[violations[index - 1].id] = label.slice(0, 60);
    }
  }
  return result;
}

/**
 * The screen's own texts, so suggested labels follow its language.
 */
export const screenTexts = (tree: UiTree, mask: (text: string) => string = (text) => text) =>
  [...new Set(tree.nodes.map(ownSpeakableText).filter((text) => text.length > 1))].slice(0, 12).map(mask);
