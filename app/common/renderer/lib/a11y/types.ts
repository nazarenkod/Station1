// Based on vision (backend/src/a11y/a11y.types.ts), with the rules Vision Inspector adds.

import type {Rect, UiTreeFormat} from './ui-tree.types';

export const A11Y_RULES = [
  // from vision
  'missing-label',
  'touch-target',
  'duplicate-label',
  'low-contrast',
  'input-without-label',
  'redundant-role',
  'not-accessible',
  // Vision Inspector
  'non-text-contrast',
  'target-spacing',
  'nested-clickable',
  'hidden-focusable',
  'non-descriptive-label',
  'hint-only-input',
  'state-missing',
  'text-clipping',
  'reading-order',
  'testability',
] as const;

export type A11yRule = (typeof A11Y_RULES)[number];

export type A11ySeverity = 'error' | 'warning' | 'info';

export interface A11yViolation {
  // rule + element identity: stable between builds, used to tell new issues from existing ones
  id: string;
  rule: A11yRule;
  severity: A11ySeverity;
  title: string;
  message: string;
  nodeKey: string;
  resourceId: string;
  className: string;
  // what a screen reader would announce, if anything
  label: string;
  bounds: Rect;
  // where the element is in the inspector's source tree
  elementPath?: string;
  // rule-specific numbers (contrast ratio, size in dp, …) for the UI and for AI prompts
  details?: Record<string, number | string | boolean>;
  // 'ai' for issues a model found, absent for rules
  source?: 'rules' | 'ai' | 'platform';
}

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface A11yScan {
  format: UiTreeFormat;
  pixelsPerDp: number;
  pixelsPerDpEstimated: boolean;
  violations: A11yViolation[];
  // focusable elements in the order a screen reader visits them, for the overlay
  readingOrder: Array<{nodeKey: string; bounds: Rect}>;
}
