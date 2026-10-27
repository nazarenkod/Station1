import {DOMParser} from '@xmldom/xmldom';

// UserDefaults of an iOS app: a property list whose root is a dict. Unlike
// the build reader, the types stay: an edited date stays a date, a number an
// integer or a real, data stays data.

const escapeXml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const elements = (node) => {
  const list = [];
  for (let child = node?.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) {
      list.push(child);
    }
  }
  return list;
};

// a nested value as plain data: what the editor shows and takes back as JSON
function plain(node) {
  switch (node.nodeName) {
    case 'dict': {
      const result = {};
      const children = elements(node);
      for (let i = 0; i + 1 < children.length; i += 2) {
        result[children[i].textContent] = plain(children[i + 1]);
      }
      return result;
    }
    case 'array':
      return elements(node).map(plain);
    case 'integer':
      return Number(node.textContent);
    case 'real':
      return Number(node.textContent);
    case 'true':
      return true;
    case 'false':
      return false;
    case 'data':
      return (node.textContent ?? '').replace(/\s+/g, '');
    default:
      return node.textContent ?? '';
  }
}

function typed(node) {
  switch (node.nodeName) {
    case 'string':
      return {type: 'string', value: node.textContent ?? ''};
    case 'integer': {
      const text = (node.textContent ?? '0').trim();
      const number = Number(text);
      // a big integer stays text, as a long does on Android
      return Number.isSafeInteger(number) ? {type: 'int', value: number} : {type: 'long', value: text};
    }
    case 'real':
      return {type: 'double', value: Number(node.textContent)};
    case 'true':
    case 'false':
      return {type: 'boolean', value: node.nodeName === 'true'};
    case 'date':
      return {type: 'date', value: (node.textContent ?? '').trim()};
    case 'data':
      return {type: 'data', value: (node.textContent ?? '').replace(/\s+/g, '')};
    case 'array':
      return {type: 'array', value: plain(node)};
    case 'dict':
      return {type: 'dict', value: plain(node)};
    default:
      return {type: 'null', value: null};
  }
}

/**
 * The top-level entries of an XML property list whose root is a dict.
 * @returns {{key: string, type: string, value: any}[]}
 */
export function parsePlistPrefs(xml) {
  const doc = new DOMParser({onError: () => {}}).parseFromString(String(xml ?? ''), 'text/xml');
  const root = elements(doc?.documentElement)[0];
  if (doc?.documentElement?.nodeName !== 'plist' || root?.nodeName !== 'dict') {
    throw new Error('Not a property list with a dict');
  }
  const children = elements(root);
  const entries = [];
  for (let i = 0; i + 1 < children.length; i += 2) {
    entries.push({key: children[i].textContent ?? '', ...typed(children[i + 1])});
  }
  return entries;
}

function plainXml(value, indent) {
  const pad = '\t'.repeat(indent);
  if (Array.isArray(value)) {
    return value.length
      ? `${pad}<array>\n${value.map((item) => plainXml(item, indent + 1)).join('')}${pad}</array>\n`
      : `${pad}<array/>\n`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    return keys.length
      ? `${pad}<dict>\n${keys.map((key) => `${pad}\t<key>${escapeXml(key)}</key>\n${plainXml(value[key], indent + 1)}`).join('')}${pad}</dict>\n`
      : `${pad}<dict/>\n`;
  }
  if (typeof value === 'boolean') {
    return `${pad}<${value}/>\n`;
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? `${pad}<integer>${value}</integer>\n` : `${pad}<real>${value}</real>\n`;
  }
  return `${pad}<string>${escapeXml(value ?? '')}</string>\n`;
}

function typedXml({type, value}, indent) {
  const pad = '\t'.repeat(indent);
  switch (type) {
    case 'int':
    case 'long':
      return `${pad}<integer>${String(value).trim()}</integer>\n`;
    case 'float':
    case 'double':
      return `${pad}<real>${Number(value)}</real>\n`;
    case 'boolean':
      return `${pad}<${value ? 'true' : 'false'}/>\n`;
    case 'date':
      return `${pad}<date>${escapeXml(value)}</date>\n`;
    case 'data':
      return `${pad}<data>${escapeXml(value)}</data>\n`;
    case 'array':
    case 'dict':
    case 'set':
      return plainXml(value ?? (type === 'dict' ? {} : []), indent);
    default:
      return `${pad}<string>${escapeXml(value ?? '')}</string>\n`;
  }
}

/** An XML property list with these entries as its root dict. */
export function writePlistPrefs(entries) {
  const body = entries.map((entry) => `\t<key>${escapeXml(entry.key)}</key>\n${typedXml(entry, 1)}`).join('');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    entries.length ? `<dict>\n${body}</dict>` : '<dict/>',
    '</plist>',
    '',
  ].join('\n');
}
