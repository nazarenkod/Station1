import {DOMParser} from '@xmldom/xmldom';

// SharedPreferences of an Android app: one XML file per name in shared_prefs/,
// written by the framework as <map> with one element per key.

const NUMBER_TYPES = ['int', 'long', 'float', 'double'];

const escapeXml = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The entries of a SharedPreferences file, in file order. A long stays a
 * string so no digit is lost; a set is a list of strings.
 * @returns {{key: string, type: string, value: any}[]}
 */
export function parseSharedPrefs(xml) {
  const doc = new DOMParser({onError: () => {}}).parseFromString(String(xml ?? ''), 'text/xml');
  const map = doc?.documentElement;
  if (!map || map.nodeName !== 'map') {
    throw new Error('Not a SharedPreferences file');
  }
  const entries = [];
  for (let node = map.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1) {
      continue;
    }
    const key = node.getAttribute('name');
    const type = node.nodeName;
    if (type === 'string') {
      entries.push({key, type, value: node.textContent ?? ''});
    } else if (type === 'boolean') {
      entries.push({key, type, value: node.getAttribute('value') === 'true'});
    } else if (type === 'long') {
      entries.push({key, type, value: node.getAttribute('value') ?? '0'});
    } else if (NUMBER_TYPES.includes(type)) {
      entries.push({key, type, value: Number(node.getAttribute('value'))});
    } else if (type === 'set') {
      const items = [];
      for (let item = node.firstChild; item; item = item.nextSibling) {
        if (item.nodeType === 1) {
          items.push(item.textContent ?? '');
        }
      }
      entries.push({key, type, value: items});
    } else if (type === 'null') {
      entries.push({key, type, value: null});
    }
  }
  return entries;
}

/**
 * A SharedPreferences file with these entries, as Android writes it.
 */
export function writeSharedPrefs(entries) {
  const lines = ["<?xml version='1.0' encoding='utf-8' standalone='yes' ?>", '<map>'];
  for (const {key, type, value} of entries) {
    const name = escapeXml(key);
    if (type === 'string') {
      lines.push(`    <string name="${name}">${escapeXml(value ?? '')}</string>`);
    } else if (type === 'set') {
      lines.push(`    <set name="${name}">`);
      for (const item of value ?? []) {
        lines.push(`        <string>${escapeXml(item)}</string>`);
      }
      lines.push('    </set>');
    } else if (type === 'null') {
      lines.push(`    <null name="${name}" />`);
    } else {
      lines.push(`    <${type} name="${name}" value="${escapeXml(value)}" />`);
    }
  }
  lines.push('</map>', '');
  return lines.join('\n');
}

// the key EncryptedSharedPreferences keeps its keyset under; the other keys and values are ciphertext
const ENCRYPTED_KEYSET = '__androidx_security_crypto_encrypted_prefs_key_keyset__';

/** Whether the keys and values of a file are encrypted (EncryptedSharedPreferences). */
export const isEncryptedPrefs = (entries) => entries.some((entry) => entry.key === ENCRYPTED_KEYSET);

/** A Flutter key splits into its grey `flutter.` prefix and the name the app uses. */
export function flutterKey(key) {
  return key.startsWith('flutter.')
    ? {prefix: 'flutter.', name: key.slice('flutter.'.length)}
    : {prefix: '', name: key};
}
