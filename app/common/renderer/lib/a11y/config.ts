import type {A11yRule, A11ySeverity} from './types';
import {A11Y_RULES} from './types';

export interface RuleSetting {
  enabled: boolean;
  severity: A11ySeverity;
}

export interface A11yConfig {
  version: 1;
  rules: Record<A11yRule, RuleSetting>;
  thresholds: {
    // Material / ATF: 48 dp; Apple HIG: 44 pt
    minTargetDp: number;
    minTargetPt: number;
    // WCAG 1.4.3 and 1.4.11
    minContrast: number;
    minContrastLarge: number;
    minNonTextContrast: number;
    // a single line taller than this (dp) is large text
    largeTextHeightDp: number;
    // gap small targets need between them (dp), WCAG 2.5.8
    minTargetSpacingDp: number;
    // labels longer than this are tiring to listen to
    maxLabelLength: number;
    // containers covering more of the screen than this are layout, not controls
    maxControlScreenShare: number;
  };
  patterns: {
    // words a label should not contain, since the role is announced anyway
    roleWords: string;
    // labels that read like code: resource names, file names, identifiers
    nonDescriptiveLabel: string;
    // the element that carries the screen title, by resource id or label
    screenTitleTag: string;
  };
}

const rule = (severity: A11ySeverity, enabled = true): RuleSetting => ({enabled, severity});

export const DEFAULT_A11Y_CONFIG: A11yConfig = {
  version: 1,
  rules: {
    'missing-label': rule('error'),
    'touch-target': rule('warning'),
    'duplicate-label': rule('warning'),
    'low-contrast': rule('warning'),
    'input-without-label': rule('warning'),
    'redundant-role': rule('info'),
    'not-accessible': rule('warning'),
    'non-text-contrast': rule('warning'),
    'target-spacing': rule('warning'),
    'nested-clickable': rule('warning'),
    'hidden-focusable': rule('warning'),
    'non-descriptive-label': rule('warning'),
    'hint-only-input': rule('info'),
    'state-missing': rule('warning'),
    'text-clipping': rule('info'),
    'reading-order': rule('info'),
    testability: rule('info'),
  },
  thresholds: {
    minTargetDp: 48,
    minTargetPt: 44,
    minContrast: 4.5,
    minContrastLarge: 3,
    minNonTextContrast: 3,
    largeTextHeightDp: 28,
    minTargetSpacingDp: 8,
    maxLabelLength: 100,
    maxControlScreenShare: 0.5,
  },
  patterns: {
    roleWords: '\\b(button|btn|image|icon|picture)\\b|кнопк|зображенн|картинк|іконк|иконк',
    nonDescriptiveLabel:
      '^(ic|img|image|icon|btn|button|iv|tv|imageview|imagebutton)[_\\-.]|^[a-z0-9]+(_[a-z0-9]+)+$|^[a-z]+([A-Z][a-z0-9]+)+$|\\.(png|jpe?g|svg|webp)$|^(null|undefined|image|button|icon|todo|test|label)$',
    screenTitleTag: 'appbar#title',
  },
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * A saved or imported config laid over the defaults: unknown keys are dropped,
 * missing ones keep their default, so older configs keep working as rules are added.
 */
export function mergeConfig(saved: unknown): A11yConfig {
  const config = structuredClone(DEFAULT_A11Y_CONFIG);
  if (!isObject(saved)) {
    return config;
  }
  if (isObject(saved.rules)) {
    for (const name of A11Y_RULES) {
      const value = saved.rules[name];
      if (isObject(value)) {
        if (typeof value.enabled === 'boolean') {
          config.rules[name].enabled = value.enabled;
        }
        if (['error', 'warning', 'info'].includes(value.severity as string)) {
          config.rules[name].severity = value.severity as A11ySeverity;
        }
      }
    }
  }
  if (isObject(saved.thresholds)) {
    for (const key of Object.keys(config.thresholds) as Array<keyof A11yConfig['thresholds']>) {
      const value = saved.thresholds[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        config.thresholds[key] = value;
      }
    }
  }
  if (isObject(saved.patterns)) {
    for (const key of Object.keys(config.patterns) as Array<keyof A11yConfig['patterns']>) {
      const value = saved.patterns[key];
      if (typeof value === 'string' && isValidPattern(value)) {
        config.patterns[key] = value;
      }
    }
  }
  return config;
}

export function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern, 'i');
    return true;
  } catch {
    return false;
  }
}
