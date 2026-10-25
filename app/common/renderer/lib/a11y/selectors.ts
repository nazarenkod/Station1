// Ported from vision (backend/src/ui-tree/comparison-inputs.ts): keep in sync until both use a shared package.

import type {UiNode} from './ui-tree.types';

/**
 * selector:
 *   id:btn_pay        resource id (Android, with or without "package:id/") or iOS accessibility identifier
 *   class:ImageView   class name or its last segment; XCUIElementType prefix optional
 *   text:12:30        exact text or label; text:/\d+:\d+/ for a regular expression
 */
export type Selector = {by: 'id'; value: string} | {by: 'class'; value: string} | {by: 'text'; value: string | RegExp};

export function parseSelector(selector: string): Selector | null {
  const match = /^(id|class|text):(.+)$/s.exec(selector.trim());
  if (!match) {
    return null;
  }
  const [, by, raw] = match;
  if (by === 'text') {
    const regex = /^\/(.+)\/([a-z]*)$/.exec(raw);
    if (regex) {
      try {
        return {by: 'text', value: new RegExp(regex[1], regex[2].includes('i') ? 'i' : '')};
      } catch {
        return null;
      }
    }
    return {by: 'text', value: raw};
  }
  return {by: by as 'id' | 'class', value: raw.trim()};
}

const shortClass = (className: string) => (className.split('.').pop() ?? className).replace('XCUIElementType', '');

export function matchesSelector(node: UiNode, selector: Selector): boolean {
  switch (selector.by) {
    case 'id': {
      const id = node.resourceId;
      if (!id) {
        return false;
      }
      const value = selector.value.replace(/^.*:id\//, '').replace(/^id\//, '');
      return id === selector.value || id.endsWith(`:id/${value}`) || id === value;
    }
    case 'class':
      return node.className === selector.value || shortClass(node.className) === shortClass(selector.value);
    case 'text': {
      const text = (node.text || node.label).trim();
      if (!text) {
        return false;
      }
      return selector.value instanceof RegExp ? selector.value.test(text) : text === selector.value;
    }
  }
}
