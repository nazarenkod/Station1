// Based on vision (backend/src/a11y/a11y.rules.ts): the first seven rules behave the same
// with the default config. Thresholds, patterns and severities come from the config here.

import type {A11yConfig} from './config';
import {DEFAULT_A11Y_CONFIG} from './config';
import {estimateContrast} from './contrast';
import type {A11yRule, A11yScan, A11yViolation, RgbaImage} from './types';
import {describeNode, ownSpeakableText} from './ui-tree';
import type {Rect, UiNode, UiTree} from './ui-tree.types';

const EDITABLE = /EditText|AutoCompleteTextView|XCUIElementType(TextField|SecureTextField|SearchField|TextView)$/;
const TEXTUAL = /TextView|Button|CheckBox|RadioButton|Switch|Chip|XCUIElementType(StaticText|Button|Link|TextView)$/;
const IOS_BUTTON = /XCUIElementType(Button|Link|Switch|Cell)$/;
// controls drawn as graphics: their outline or glyph is what has to stand out
const NON_TEXT_CONTROL =
  /ImageButton|ImageView|Switch|CheckBox|RadioButton|ToggleButton|XCUIElementType(Button|Switch|Image)$/;
const STATEFUL = /Switch|CheckBox|RadioButton|ToggleButton|CompoundButton|XCUIElementType(Switch|CheckBox)$/;
const ELLIPSIS = /(…|\.\.\.)\s*$/;
// rows closer than this (dp) count as the same line when ordering by position
const ROW_TOLERANCE_DP = 8;

interface Context {
  tree: UiTree;
  children: number[][];
  image?: RgbaImage;
  config: A11yConfig;
  roleWords: RegExp;
  nonDescriptive: RegExp;
}

function buildContext(tree: UiTree, config: A11yConfig, image?: RgbaImage): Context {
  const children: number[][] = tree.nodes.map(() => []);
  tree.nodes.forEach((node) => {
    if (node.parent !== null) {
      children[node.parent].push(node.index);
    }
  });
  return {
    tree,
    children,
    image,
    config,
    roleWords: new RegExp(config.patterns.roleWords, 'i'),
    nonDescriptive: new RegExp(config.patterns.nonDescriptiveLabel),
  };
}

const isShown = (node: UiNode) => node.visible && node.bounds.width > 0 && node.bounds.height > 0;

const isOnScreen = (node: UiNode, ctx: Context) =>
  node.bounds.x >= 0 &&
  node.bounds.y >= 0 &&
  node.bounds.x + node.bounds.width <= ctx.tree.width + 1 &&
  node.bounds.y + node.bounds.height <= ctx.tree.height + 1;

function isControl(node: UiNode, ctx: Context): boolean {
  if (!isShown(node) || !node.enabled || !node.clickable) {
    return false;
  }
  const screen = ctx.tree.width * ctx.tree.height;
  return (
    screen <= 0 || (node.bounds.width * node.bounds.height) / screen <= ctx.config.thresholds.maxControlScreenShare
  );
}

/**
 * What a screen reader announces for a control: its own label or text, or —
 * on Android, where a clickable container reads out its children, and on iOS
 * for containers that are not accessibility elements — the text of
 * non-clickable descendants.
 */
function speakableText(node: UiNode, ctx: Context): string {
  const own = ownSpeakableText(node);
  // an iOS element that is itself accessible is read on its own; one that is not
  // (a table cell, a container) lets VoiceOver read its children instead
  if (own || (ctx.tree.format === 'appium-ios' && node.accessible)) {
    return own;
  }
  const parts: string[] = [];
  const visit = (index: number) => {
    for (const childIndex of ctx.children[index]) {
      const child = ctx.tree.nodes[childIndex];
      if (child.clickable) {
        continue;
      }
      const text = ownSpeakableText(child);
      if (text) {
        parts.push(text);
      } else {
        visit(childIndex);
      }
    }
  };
  visit(node.index);
  return parts.join(' ').trim();
}

const isAncestor = (ancestor: UiNode, node: UiNode, ctx: Context) => {
  for (let index = node.parent; index !== null; index = ctx.tree.nodes[index].parent) {
    if (index === ancestor.index) {
      return true;
    }
  }
  return false;
};

function violation(
  rule: A11yRule,
  node: UiNode,
  ctx: Context,
  title: string,
  message: string,
  details?: A11yViolation['details'],
): A11yViolation {
  return {
    id: `${rule}|${node.key}`,
    rule,
    severity: ctx.config.rules[rule].severity,
    title,
    message,
    nodeKey: node.key,
    resourceId: node.resourceId,
    className: node.className,
    label: speakableText(node, ctx),
    bounds: node.bounds,
    ...(node.elementPath !== undefined ? {elementPath: node.elementPath} : {}),
    details: {element: describeNode(node), ...details},
    source: 'rules',
  };
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const toDp = (pixels: number, ctx: Context) => pixels / ctx.tree.pixelsPerDp;
const unitOf = (ctx: Context) => (ctx.tree.format === 'appium-ios' ? 'pt' : 'dp');
const minTarget = (ctx: Context) =>
  ctx.tree.format === 'appium-ios' ? ctx.config.thresholds.minTargetPt : ctx.config.thresholds.minTargetDp;
const readerOf = (ctx: Context) => (ctx.tree.format === 'appium-ios' ? 'VoiceOver' : 'TalkBack');

function checkMissingLabel(node: UiNode, ctx: Context): A11yViolation[] {
  // inputs are covered by checkInputLabel, which also accepts a hint
  if (!isControl(node, ctx) || EDITABLE.test(node.className) || speakableText(node, ctx)) {
    return [];
  }
  return [
    violation(
      'missing-label',
      node,
      ctx,
      'Control has no label',
      `${describeNode(node)} has nothing for ${readerOf(ctx)} to read out.`,
      {reader: readerOf(ctx)},
    ),
  ];
}

function isSmallTarget(node: UiNode, ctx: Context) {
  const min = minTarget(ctx);
  // half a unit of slack for rounding in bounds and density
  return toDp(node.bounds.width, ctx) < min - 0.5 || toDp(node.bounds.height, ctx) < min - 0.5;
}

function checkTouchTarget(node: UiNode, ctx: Context): A11yViolation[] {
  if (!isControl(node, ctx) || !isSmallTarget(node, ctx)) {
    return [];
  }
  const min = minTarget(ctx);
  const width = toDp(node.bounds.width, ctx);
  const height = toDp(node.bounds.height, ctx);
  const unit = unitOf(ctx);
  return [
    violation(
      'touch-target',
      node,
      ctx,
      'Touch target too small',
      `${describeNode(node)} is ${Math.round(width)} × ${Math.round(height)} ${unit}, minimum is ${min} × ${min} ${unit}.`,
      {
        widthDp: round1(width),
        heightDp: round1(height),
        min,
        unit,
        estimatedDensity: ctx.tree.pixelsPerDpEstimated,
      },
    ),
  ];
}

function checkDuplicateLabels(ctx: Context): A11yViolation[] {
  const byLabel = new Map<string, UiNode[]>();
  for (const node of ctx.tree.nodes) {
    if (!isControl(node, ctx)) {
      continue;
    }
    const label = speakableText(node, ctx).toLowerCase().replace(/\s+/g, ' ');
    if (!label) {
      continue;
    }
    byLabel.set(label, [...(byLabel.get(label) ?? []), node]);
  }
  const result: A11yViolation[] = [];
  for (const [label, nodes] of byLabel) {
    if (nodes.length < 2) {
      continue;
    }
    for (const node of nodes) {
      result.push(
        violation(
          'duplicate-label',
          node,
          ctx,
          'Same label on several controls',
          `${nodes.length} controls are announced as "${label.slice(0, 40)}"; users cannot tell them apart.`,
          {count: nodes.length, label: label.slice(0, 40)},
        ),
      );
    }
  }
  return result;
}

function checkContrast(node: UiNode, ctx: Context): A11yViolation[] {
  if (!ctx.image || !isShown(node) || !node.text.trim() || !TEXTUAL.test(node.className)) {
    return [];
  }
  const estimate = estimateContrast(ctx.image, node.bounds);
  if (!estimate) {
    return [];
  }
  const {minContrast, minContrastLarge, largeTextHeightDp} = ctx.config.thresholds;
  const large = toDp(node.bounds.height, ctx) >= largeTextHeightDp && node.text.length <= 30;
  const required = large ? minContrastLarge : minContrast;
  if (estimate.ratio >= required) {
    return [];
  }
  return [
    violation(
      'low-contrast',
      node,
      ctx,
      'Low text contrast',
      `${describeNode(node)}: ${estimate.ratio.toFixed(1)} : 1, needs ${required} : 1.`,
      {ratio: estimate.ratio, required, foreground: estimate.foreground, background: estimate.background},
    ),
  ];
}

function checkNonTextContrast(node: UiNode, ctx: Context): A11yViolation[] {
  // text has its own, stricter check
  if (!ctx.image || !isControl(node, ctx) || node.text.trim() || !NON_TEXT_CONTROL.test(node.className)) {
    return [];
  }
  const estimate = estimateContrast(ctx.image, node.bounds);
  if (!estimate) {
    return [];
  }
  const required = ctx.config.thresholds.minNonTextContrast;
  if (estimate.ratio >= required) {
    return [];
  }
  return [
    violation(
      'non-text-contrast',
      node,
      ctx,
      'Low contrast of a control',
      `${describeNode(node)}: its graphic stands out ${estimate.ratio.toFixed(1)} : 1 from the background, needs ${required} : 1.`,
      {ratio: estimate.ratio, required, foreground: estimate.foreground, background: estimate.background},
    ),
  ];
}

function checkInputLabel(node: UiNode, ctx: Context): A11yViolation[] {
  if (!isShown(node) || !EDITABLE.test(node.className)) {
    return [];
  }
  if (node.label.trim() || node.hint.trim() || node.text.trim()) {
    return [];
  }
  return [
    violation(
      'input-without-label',
      node,
      ctx,
      'Input has no label or hint',
      `${describeNode(node)} gives no clue what to enter.`,
    ),
  ];
}

function checkHintOnlyInput(node: UiNode, ctx: Context): A11yViolation[] {
  // a hint vanishes as soon as something is typed, the field then has no name
  if (!isShown(node) || !EDITABLE.test(node.className) || node.label.trim() || !node.hint.trim()) {
    return [];
  }
  return [
    violation(
      'hint-only-input',
      node,
      ctx,
      'Input is named only by its hint',
      `${describeNode(node)} is named by the hint "${node.hint.slice(0, 40)}", which disappears once text is entered.`,
      {hint: node.hint.slice(0, 40)},
    ),
  ];
}

function checkRedundantRole(node: UiNode, ctx: Context): A11yViolation[] {
  if (!isControl(node, ctx) || !ctx.roleWords.test(node.label)) {
    return [];
  }
  return [
    violation(
      'redundant-role',
      node,
      ctx,
      'Label repeats the role',
      `"${node.label.slice(0, 40)}" already gets its role announced; drop words like "button" or "image".`,
      {label: node.label.slice(0, 40)},
    ),
  ];
}

function checkNonDescriptiveLabel(node: UiNode, ctx: Context): A11yViolation[] {
  const label = node.label.trim();
  if (!label || !isShown(node) || !(node.clickable || /Image/.test(node.className))) {
    return [];
  }
  const idName = node.resourceId.replace(/^.*[:/]/, '');
  const looksLikeCode = ctx.nonDescriptive.test(label) || (idName && label === idName);
  const tooLong = label.length > ctx.config.thresholds.maxLabelLength;
  if (!looksLikeCode && !tooLong) {
    return [];
  }
  return [
    violation(
      'non-descriptive-label',
      node,
      ctx,
      tooLong ? 'Label is too long' : 'Label reads like code',
      tooLong
        ? `${describeNode(node)} is announced with ${label.length} characters; keep it short and put details elsewhere.`
        : `"${label.slice(0, 40)}" is a resource or identifier name, not words a person understands.`,
      {label: label.slice(0, 60), length: label.length, reason: tooLong ? 'long' : 'code'},
    ),
  ];
}

const hasAccessibleDescendant = (node: UiNode, ctx: Context): boolean =>
  ctx.children[node.index].some((index) => {
    const child = ctx.tree.nodes[index];
    return (child.accessible && isShown(child)) || hasAccessibleDescendant(child, ctx);
  });

function checkIosAccessible(node: UiNode, ctx: Context): A11yViolation[] {
  if (ctx.tree.format !== 'appium-ios' || node.accessible || !isShown(node) || !IOS_BUTTON.test(node.className)) {
    return [];
  }
  // disabled decorations (a cell's chevron) and cells whose content VoiceOver
  // reads element by element are fine: only controls nobody can reach count
  if (!node.enabled || hasAccessibleDescendant(node, ctx)) {
    return [];
  }
  return [
    violation(
      'not-accessible',
      node,
      ctx,
      'Control hidden from VoiceOver',
      `${describeNode(node)} has isAccessibilityElement = false.`,
    ),
  ];
}

function checkHiddenFocusable(node: UiNode, ctx: Context): A11yViolation[] {
  // XCUITest marks scrolled-away elements invisible too: only ones within the screen count
  if (ctx.tree.format !== 'appium-ios' || node.visible || !node.accessible) {
    return [];
  }
  if (node.bounds.width <= 0 || node.bounds.height <= 0 || !isOnScreen(node, ctx)) {
    return [];
  }
  if (!IOS_BUTTON.test(node.className) && !node.label.trim()) {
    return [];
  }
  // inside an invisible container (a row scrolled away) XCUITest reports stale frames
  const parent = node.parent === null ? null : ctx.tree.nodes[node.parent];
  if (parent && !parent.visible) {
    return [];
  }
  return [
    violation(
      'hidden-focusable',
      node,
      ctx,
      'Invisible element VoiceOver can focus',
      `${describeNode(node)} is not visible but VoiceOver still stops on it.`,
    ),
  ];
}

function checkStateMissing(node: UiNode, ctx: Context): A11yViolation[] {
  if (!isShown(node) || !STATEFUL.test(node.className)) {
    return [];
  }
  const missing = ctx.tree.format === 'appium-ios' ? !node.text.trim() : !node.checkable;
  if (!missing) {
    return [];
  }
  return [
    violation(
      'state-missing',
      node,
      ctx,
      'On/off state is not exposed',
      `${describeNode(node)} looks like a toggle but does not tell ${readerOf(ctx)} whether it is on or off.`,
      {reader: readerOf(ctx)},
    ),
  ];
}

function checkNestedClickable(node: UiNode, ctx: Context): A11yViolation[] {
  // iOS cells holding buttons are normal; on Android a clickable parent swallows its children
  if (ctx.tree.format !== 'appium-android' || !isControl(node, ctx)) {
    return [];
  }
  const nested: UiNode[] = [];
  const visit = (index: number) => {
    for (const childIndex of ctx.children[index]) {
      const child = ctx.tree.nodes[childIndex];
      if (isControl(child, ctx)) {
        nested.push(child);
      } else {
        visit(childIndex);
      }
    }
  };
  visit(node.index);
  if (!nested.length) {
    return [];
  }
  return [
    violation(
      'nested-clickable',
      node,
      ctx,
      'Clickable inside clickable',
      `${describeNode(node)} contains ${nested.length} other control(s); TalkBack may read them as one and activate the wrong one.`,
      {count: nested.length},
    ),
  ];
}

const expand = (rect: Rect, by: number): Rect => ({
  x: rect.x - by,
  y: rect.y - by,
  width: rect.width + 2 * by,
  height: rect.height + 2 * by,
});

const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function checkTargetSpacing(ctx: Context): A11yViolation[] {
  const controls = ctx.tree.nodes.filter((node) => isControl(node, ctx));
  const gap = ctx.config.thresholds.minTargetSpacingDp * ctx.tree.pixelsPerDp;
  const result: A11yViolation[] = [];
  for (const node of controls) {
    if (!isSmallTarget(node, ctx)) {
      continue;
    }
    const neighbours = controls.filter(
      (other) =>
        other !== node &&
        !isAncestor(other, node, ctx) &&
        !isAncestor(node, other, ctx) &&
        intersects(expand(node.bounds, gap / 2), expand(other.bounds, gap / 2)),
    );
    if (!neighbours.length) {
      continue;
    }
    result.push(
      violation(
        'target-spacing',
        node,
        ctx,
        'Small target too close to others',
        `${describeNode(node)} is small and less than ${ctx.config.thresholds.minTargetSpacingDp} ${unitOf(ctx)} away from ${describeNode(neighbours[0])}; easy to tap the wrong one.`,
        {neighbour: describeNode(neighbours[0]), gap: ctx.config.thresholds.minTargetSpacingDp, unit: unitOf(ctx)},
      ),
    );
  }
  return result;
}

function checkTextClipping(node: UiNode, ctx: Context): A11yViolation[] {
  if (!isShown(node) || !TEXTUAL.test(node.className) || !ELLIPSIS.test(node.text)) {
    return [];
  }
  return [
    violation(
      'text-clipping',
      node,
      ctx,
      'Text is cut off',
      `${describeNode(node)} ends with an ellipsis; with larger fonts even more of it may be lost.`,
    ),
  ];
}

function checkTestability(node: UiNode, ctx: Context): A11yViolation[] {
  if (!isControl(node, ctx) || node.resourceId) {
    return [];
  }
  return [
    violation(
      'testability',
      node,
      ctx,
      'No stable id for tests',
      `${describeNode(node)} has no ${ctx.tree.format === 'appium-ios' ? 'accessibilityIdentifier' : 'resource-id'}; tests have to find it by text or position.`,
      {attribute: ctx.tree.format === 'appium-ios' ? 'accessibilityIdentifier' : 'resource-id'},
    ),
  ];
}

/**
 * Elements a screen reader stops on, in the order it visits them: on Android
 * controls and texts that are not part of a clickable parent, on iOS the
 * accessible leaves. Tree order is the traversal order on both platforms.
 */
export function readingOrder(tree: UiTree, config: A11yConfig = DEFAULT_A11Y_CONFIG): UiNode[] {
  const ctx = buildContext(tree, config);
  const insideControl = (node: UiNode) => {
    for (let index = node.parent; index !== null; index = tree.nodes[index].parent) {
      if (isControl(tree.nodes[index], ctx)) {
        return true;
      }
    }
    return false;
  };
  return tree.nodes.filter((node) => {
    if (!isShown(node) || !isOnScreen(node, ctx)) {
      return false;
    }
    if (tree.format === 'appium-ios') {
      return node.accessible && ctx.children[node.index].length === 0 && !!(ownSpeakableText(node) || node.clickable);
    }
    if (isControl(node, ctx)) {
      return !insideControl(node);
    }
    return !!ownSpeakableText(node) && !insideControl(node) && ctx.children[node.index].length === 0;
  });
}

function checkReadingOrder(order: UiNode[], ctx: Context): A11yViolation[] {
  const tolerance = ROW_TOLERANCE_DP * ctx.tree.pixelsPerDp;
  const result: A11yViolation[] = [];
  for (let i = 1; i < order.length; i++) {
    const previous = order[i - 1].bounds;
    const current = order[i].bounds;
    const sameColumn = current.x < previous.x + previous.width && previous.x < current.x + current.width;
    // the next stop sits clearly above the previous one in the same column: focus jumps back up
    if (sameColumn && current.y + current.height <= previous.y - tolerance) {
      result.push(
        violation(
          'reading-order',
          order[i],
          ctx,
          'Reading order jumps back',
          `${readerOf(ctx)} reaches ${describeNode(order[i])} after ${describeNode(order[i - 1])}, which is below it on screen.`,
          {previous: describeNode(order[i - 1]), position: i + 1, reader: readerOf(ctx)},
        ),
      );
    }
  }
  return result;
}

type NodeRule = (node: UiNode, ctx: Context) => A11yViolation[];

const NODE_RULES: Array<[A11yRule, NodeRule]> = [
  ['missing-label', checkMissingLabel],
  ['touch-target', checkTouchTarget],
  ['low-contrast', checkContrast],
  ['non-text-contrast', checkNonTextContrast],
  ['input-without-label', checkInputLabel],
  ['hint-only-input', checkHintOnlyInput],
  ['redundant-role', checkRedundantRole],
  ['non-descriptive-label', checkNonDescriptiveLabel],
  ['not-accessible', checkIosAccessible],
  ['hidden-focusable', checkHiddenFocusable],
  ['state-missing', checkStateMissing],
  ['nested-clickable', checkNestedClickable],
  ['text-clipping', checkTextClipping],
  ['testability', checkTestability],
];

const SEVERITY_ORDER = {error: 0, warning: 1, info: 2};

/**
 * All accessibility issues of one screen with the given config. The screenshot
 * is only needed for the contrast rules.
 */
export function findViolations(
  tree: UiTree,
  image?: RgbaImage,
  config: A11yConfig = DEFAULT_A11Y_CONFIG,
): A11yViolation[] {
  return scanScreen(tree, image, config).violations;
}

export function scanScreen(tree: UiTree, image?: RgbaImage, config: A11yConfig = DEFAULT_A11Y_CONFIG): A11yScan {
  const ctx = buildContext(tree, config, image);
  const enabled = (rule: A11yRule) => config.rules[rule]?.enabled !== false;
  const rules = NODE_RULES.filter(([rule]) => enabled(rule)).map(([, check]) => check);
  const found = tree.nodes.flatMap((node) => rules.flatMap((check) => check(node, ctx)));
  if (enabled('duplicate-label')) {
    found.push(...checkDuplicateLabels(ctx));
  }
  if (enabled('target-spacing')) {
    found.push(...checkTargetSpacing(ctx));
  }
  const order = readingOrder(tree, config);
  if (enabled('reading-order')) {
    found.push(...checkReadingOrder(order, ctx));
  }
  // one entry per id: the same element can't be reported twice by the same rule
  const violations = [...new Map(found.map((v) => [v.id, v])).values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x,
  );
  return {
    format: tree.format,
    pixelsPerDp: tree.pixelsPerDp,
    pixelsPerDpEstimated: tree.pixelsPerDpEstimated,
    violations,
    readingOrder: order.map((node) => ({nodeKey: node.key, bounds: node.bounds})),
  };
}
