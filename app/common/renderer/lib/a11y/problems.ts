// Ported from vision (backend/src/a11y/a11y-problems.ts): keep in sync until both use a shared package.
// Vision Inspector adds default duplicate modes for its own rules and the AI's, a SHA-1 that runs in
// the browser (same ids as vision's node:crypto), and contrast of controls as a measured value.

import {matchesSelector, parseSelector} from './selectors';
import {sha1Hex} from './sha1';
import type {A11yRule, A11yViolation} from './types';
import type {UiNode, UiTree} from './ui-tree.types';

/**
 * When two issues are the same problem, per rule or per class:
 * - component-value: same component id and the same measured values (a 38 × 38 dp
 *   tap area everywhere is one problem; 38 × 40 on another screen is another);
 * - component: same component id, whatever the values;
 * - screen: never across screens; one problem per element id on a screen;
 * - class (classes only): everything the class takes, per rule, is one problem.
 * Elements without an id are always problems of their own screen, unless a class says otherwise.
 */
export type DuplicateMode = 'component-value' | 'component' | 'screen';
export type GroupBy = DuplicateMode | 'class';

export const DEFAULT_DUPLICATE_MODES: Record<string, DuplicateMode> = {
  'touch-target': 'component-value',
  'low-contrast': 'component-value',
  'missing-label': 'component',
  'input-without-label': 'component',
  'redundant-role': 'component',
  'not-accessible': 'component',
  // two controls announced alike is about what else is on that screen
  'duplicate-label': 'screen',
  // Vision Inspector rules
  'non-text-contrast': 'component-value',
  'nested-clickable': 'component',
  'hidden-focusable': 'component',
  'non-descriptive-label': 'component',
  'hint-only-input': 'component',
  'state-missing': 'component',
  testability: 'component',
  // about the neighbours, the text or the order of one screen
  'target-spacing': 'screen',
  'text-clipping': 'screen',
  'reading-order': 'screen',
};

export const DEFAULT_SCREEN_TITLE_SELECTORS = ['id:Appbar#Title'];

/**
 * What is known about one occurrence of a problem, independent of any
 * setting. Problems keep these, so when the settings change, what is one
 * problem is worked out again from the facts, and ids and bugs stay.
 */
export interface ProblemFacets {
  rule: string;
  // the element id (resource id or Compose tag) without the "#1" of repeats; null without one
  element: string | null;
  // the element's identity on its screen (id:…, Class:text or path:…)
  nodeKey: string;
  // the component by the default reading of the id (…#PbButton → PbButton)
  component: string | null;
  // the screen's title, else the check's name
  screen: string;
  // what the rule measured (38x38, 3.1), empty where it measures nothing
  measure: string;
  className: string;
  label: string;
}

/**
 * Conditions of a class on the facts of an issue: every field given must
 * match (and), any of the patterns of a field may (or). Patterns are globs
 * with * and ?, or /regex/; a group in an element pattern is the component id.
 */
export interface ClassConditions {
  element?: string[];
  screen?: string[];
  className?: string[];
  label?: string[];
}

/**
 * A class of problems the project defines: which issues it takes and what
 * they are — how duplicates are told, which part of the id is the
 * component, and whether bugs are filed for them or they are ignored. The
 * first class that takes an issue wins.
 */
export interface ProblemClass {
  id: string;
  name: string;
  // rules it takes; empty or absent for every rule
  rules?: string[];
  when?: ClassConditions;
  // an element pattern, as classes were first written; read as when.element
  match?: string;
  groupBy?: GroupBy;
  // as classes were first written; read as groupBy
  mode?: DuplicateMode;
  // report: found and filed as usual; ignore: listed with the false positives, never counted or filed
  action?: 'report' | 'ignore';
}

export interface ProblemSettings {
  duplicateModes?: Partial<Record<string, DuplicateMode>>;
  classes?: ProblemClass[];
}

const patterns = new Map<string, RegExp | null>();

/** A class pattern as a regex: /regex/flags as written, else a whole-value glob; null when it does not compile. */
export function compilePattern(pattern: string): RegExp | null {
  if (!patterns.has(pattern)) {
    let compiled: RegExp | null;
    try {
      const regex = /^\/(.+)\/([a-z]*)$/s.exec(pattern.trim());
      if (regex) {
        compiled = new RegExp(regex[1], regex[2].replace(/[^imsu]/g, ''));
      } else {
        const glob = pattern
          .trim()
          .replace(/[.+^$(){}|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        compiled = new RegExp(`^${glob}$`, 'i');
      }
    } catch {
      compiled = null;
    }
    if (patterns.size > 1000) {
      patterns.clear();
    }
    patterns.set(pattern, compiled);
  }
  return patterns.get(pattern) ?? null;
}

/**
 * The component id of an element, from its key, or null when it has none:
 * the part of a Compose test tag after "#" (…#PbButton), else the resource id
 * without its package. Elements of a screen with the same id are told apart
 * by "#1", "#2"…, which is dropped: they are the same component.
 */
export function componentOf(elementKey: string): string | null {
  if (!elementKey.startsWith('id:')) {
    return null;
  }
  const id = elementKey.slice(3).replace(/#\d+$/, '');
  const component = id.includes('#') ? id.slice(id.lastIndexOf('#') + 1) : id.replace(/^.*:id\//, '');
  return component.trim() || null;
}

/** What the rule measured, where it measures: the values a problem is the same with. */
export function measurementOf(violation: Pick<A11yViolation, 'rule' | 'details'>): string {
  const details = violation.details ?? {};
  if (violation.rule === 'touch-target' && details.widthDp !== undefined) {
    return `${Math.round(Number(details.widthDp))}x${Math.round(Number(details.heightDp))}`;
  }
  if ((violation.rule === 'low-contrast' || violation.rule === 'non-text-contrast') && details.ratio !== undefined) {
    return Number(details.ratio).toFixed(1);
  }
  return '';
}

/** The facts of an issue on a screen. */
export function facetsOf(
  violation: Pick<A11yViolation, 'rule' | 'nodeKey' | 'details'> & Partial<Pick<A11yViolation, 'className' | 'label'>>,
  screen: string,
): ProblemFacets {
  return {
    rule: violation.rule,
    element: violation.nodeKey.startsWith('id:') ? violation.nodeKey.slice(3).replace(/#\d+$/, '') : null,
    nodeKey: violation.nodeKey,
    component: componentOf(violation.nodeKey),
    screen,
    measure: measurementOf(violation),
    className: violation.className ?? '',
    label: violation.label ?? '',
  };
}

const conditionsOf = (problemClass: ProblemClass): ClassConditions => ({
  ...problemClass.when,
  ...(!problemClass.when?.element?.length && problemClass.match ? {element: [problemClass.match]} : {}),
});

export const groupByOf = (problemClass: ProblemClass): GroupBy | undefined => problemClass.groupBy ?? problemClass.mode;

/** The first pattern of a list that matches a value, with its match; undefined when the list is empty. */
function matchAny(list: string[] | undefined, value: string): RegExpExecArray | null | undefined {
  const given = (list ?? []).filter((item) => item?.trim());
  if (!given.length) {
    return undefined;
  }
  for (const pattern of given) {
    const match = compilePattern(pattern)?.exec(value);
    if (match) {
      return match;
    }
  }
  return null;
}

/** The class that takes an issue, and the component its element pattern captured, if any. */
export function classOf(
  facets: ProblemFacets,
  classes: ProblemClass[] = [],
): {problemClass: ProblemClass; component: string | null} | null {
  for (const problemClass of classes) {
    if (problemClass.rules?.length && !problemClass.rules.includes(facets.rule)) {
      continue;
    }
    const when = conditionsOf(problemClass);
    const element = matchAny(when.element, facets.element ?? facets.nodeKey);
    const checks = [
      element,
      matchAny(when.screen, facets.screen),
      matchAny(when.className, facets.className),
      matchAny(when.label, facets.label),
    ];
    // a class without any condition takes nothing: it would swallow every issue of its rules by mistake
    if (checks.every((check) => check === undefined) || checks.some((check) => check === null)) {
      continue;
    }
    return {problemClass, component: element?.[1]?.trim() || null};
  }
  return null;
}

export function duplicateModeOf(rule: string, settings: ProblemSettings = {}): DuplicateMode {
  const mode = settings.duplicateModes?.[rule];
  return mode === 'component-value' || mode === 'component' || mode === 'screen'
    ? mode
    : (DEFAULT_DUPLICATE_MODES[rule as A11yRule] ?? 'screen');
}

/** How an issue is told from others under the current settings: its class, component and grouping. */
export function readingOf(facets: ProblemFacets, settings: ProblemSettings = {}) {
  const taken = classOf(facets, settings.classes);
  const groupBy: GroupBy = (taken && groupByOf(taken.problemClass)) || duplicateModeOf(facets.rule, settings);
  return {
    problemClass: taken?.problemClass ?? null,
    component: taken?.component ?? facets.component,
    groupBy,
  };
}

/**
 * Which problem an occurrence is under the current settings. Worked out from
 * the facts every time, for issues and for stored problems alike, so the
 * settings decide what is one problem without changing any problem's id.
 */
export function problemKeyOf(facets: ProblemFacets, settings: ProblemSettings = {}): string {
  const {problemClass, component, groupBy} = readingOf(facets, settings);
  if (groupBy === 'class' && problemClass) {
    return `${facets.rule}|k:${problemClass.id}|`;
  }
  if (component && groupBy !== 'screen') {
    return `${facets.rule}|c:${component}|${groupBy === 'component-value' ? facets.measure : ''}`;
  }
  return component
    ? `${facets.rule}|s:${facets.screen}|c:${component}|${facets.measure}`
    : `${facets.rule}|s:${facets.screen}|e:${facets.nodeKey}`;
}

/**
 * The id a new problem gets, as people see it in Vision and in Jira (summary,
 * label, description): short, searchable as one word. Given once, at
 * creation, and kept: later settings never change it.
 */
export function problemCode(projectId: string, key: string): string {
  return `a11y-${sha1Hex(`${projectId}\n${key}`).slice(0, 8)}`;
}

/** The component a problem key is about, if it is a component problem. */
export function problemComponent(key: string): string | null {
  const match = /\|c:([^|]+)\|/.exec(key);
  return match ? match[1] : null;
}

/** Problems that hold on every screen (a component's or a class's), rather than on one screen. */
export const isComponentProblem = (key: string) => /^[^|]+\|[ck]:/.test(key);

/** A Jira label from free text: labels take no spaces. */
export const asLabel = (value: string) => value.replace(/[^\p{L}\p{N}_.-]+/gu, '_').slice(0, 100);

/**
 * Markers of a problem in Jira, as labels: its id, the rule, the component,
 * the measured values and the class. Bugs are found by the id, or by the
 * markers the current settings tell problems apart with, so a bug filed
 * under other settings, by another Vision or by hand with the markers is
 * found too.
 */
export function problemMarkers(code: string, facets: ProblemFacets, settings: ProblemSettings = {}): string[] {
  const {problemClass, component} = readingOf(facets, settings);
  return [
    code,
    `a11y-${facets.rule}`,
    ...(component ? [asLabel(`a11y-component-${component}`)] : []),
    ...(facets.measure ? [asLabel(`a11y-value-${facets.measure}`)] : []),
    ...(problemClass ? [asLabel(`a11y-class-${problemClass.name}`)] : []),
  ];
}

/**
 * The labels a bug of the same problem carries under the current settings,
 * all of which must be on it; null when the problem is one screen's (found
 * by its id only).
 */
export function markerQuery(facets: ProblemFacets, settings: ProblemSettings = {}): string[] | null {
  const {problemClass, component, groupBy} = readingOf(facets, settings);
  if (groupBy === 'class' && problemClass) {
    return [`a11y-${facets.rule}`, asLabel(`a11y-class-${problemClass.name}`)];
  }
  if (!component || groupBy === 'screen') {
    return null;
  }
  return [
    `a11y-${facets.rule}`,
    asLabel(`a11y-component-${component}`),
    ...(groupBy === 'component-value' && facets.measure ? [asLabel(`a11y-value-${facets.measure}`)] : []),
  ];
}

/** The label a bug gets when it is unlinked from a problem: a11y-3f9c2a1b → a11y-unlinked-3f9c2a1b. */
export const unlinkedLabel = (code: string) => code.replace(/^a11y-/, 'a11y-unlinked-');

/** Labels Vision puts on bugs (to take them off when a bug is unlinked). */
export const isVisionMarker = (label: string) => /^a11y-/.test(label) && !/^a11y-unlinked/.test(label);

/** Facts of a problem stored before facts were kept, read back from its key. */
export function facetsFromKey(key: string): ProblemFacets {
  const [rule, ...parts] = key.split('|');
  const part = (prefix: string) => parts.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? null;
  const component = part('c:');
  const nodeKey = part('e:') ?? (component ? `id:${component}` : '');
  const measure = parts[parts.length - 1]?.includes(':') ? '' : (parts[parts.length - 1] ?? '');
  return {
    rule,
    element: component,
    nodeKey,
    component,
    screen: part('s:') ?? '',
    measure,
    className: '',
    label: '',
  };
}

const textOf = (tree: UiTree, node: UiNode, selectorValue: string): string | null => {
  // a content description that is the tag itself is not the title
  const tagged = node.label.toLowerCase() === selectorValue.toLowerCase();
  const own = [node.text, tagged ? '' : node.label].find((value) => value?.trim());
  if (own) {
    return own.trim();
  }
  // the tag can sit on a container whose child holds the text
  const child = tree.nodes.find((item) => item.parent === node.index && (item.text || item.label));
  return child ? (child.text || child.label).trim() : null;
};

/**
 * The screen's own title from the UI tree, by the project's selectors (first
 * match wins): `id:Appbar#Title` (a resource id or a content description),
 * `class:…`, `text:…` or `text:/regex/`. Null when none matches.
 */
export function screenTitle(tree: UiTree | null, selectors: string[] = DEFAULT_SCREEN_TITLE_SELECTORS): string | null {
  if (!tree) {
    return null;
  }
  for (const raw of selectors) {
    const selector = parseSelector(raw.includes(':') ? raw : `id:${raw}`);
    if (!selector) {
      continue;
    }
    const value = typeof selector.value === 'string' ? selector.value : '';
    const node = tree.nodes.find(
      (item) =>
        matchesSelector(item, selector) ||
        (selector.by === 'id' && !!item.label && item.label.toLowerCase() === value.toLowerCase()),
    );
    const title = node ? textOf(tree, node, value) : null;
    if (title) {
      return title;
    }
  }
  return null;
}
