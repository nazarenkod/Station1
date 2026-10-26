import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {runTool} from '../doctor/exec.js';

const decode = (text) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/**
 * Parses an XML property list into plain values. <data> stays base64,
 * <date> stays its ISO text.
 */
export function parseXmlPlist(xml) {
  const tokens = [];
  const pattern = /<(\/?)(dict|array|key|string|integer|real|true|false|date|data)(\s*\/)?>/g;
  let match;
  let lastIndex = 0;
  while ((match = pattern.exec(xml))) {
    const [, closing, tag, selfClosing] = match;
    if (closing) {
      tokens.push({type: 'close', tag, text: xml.slice(lastIndex, match.index)});
    } else {
      tokens.push({type: selfClosing ? 'empty' : 'open', tag});
    }
    lastIndex = pattern.lastIndex;
  }

  let i = 0;
  const value = () => {
    const token = tokens[i++];
    if (!token) {
      return undefined;
    }
    const {tag} = token;
    if (tag === 'true' || tag === 'false') {
      if (token.type === 'open') {
        i++; // <true></true>
      }
      return tag === 'true';
    }
    if (token.type === 'empty') {
      return tag === 'dict' ? {} : tag === 'array' ? [] : '';
    }
    if (tag === 'dict') {
      const dict = {};
      while (tokens[i] && !(tokens[i].type === 'close' && tokens[i].tag === 'dict')) {
        const keyOpen = tokens[i++];
        const keyClose = tokens[i++];
        if (keyOpen?.tag !== 'key' || !keyClose) {
          break;
        }
        dict[decode(keyClose.text)] = value();
      }
      i++;
      return dict;
    }
    if (tag === 'array') {
      const list = [];
      while (tokens[i] && !(tokens[i].type === 'close' && tokens[i].tag === 'array')) {
        list.push(value());
      }
      i++;
      return list;
    }
    const close = tokens[i++];
    const text = decode(close?.text ?? '');
    if (tag === 'integer') {
      return Number.parseInt(text, 10);
    }
    if (tag === 'real') {
      return Number.parseFloat(text);
    }
    if (tag === 'data') {
      return text.replace(/\s+/g, '');
    }
    return text;
  };

  // skip to the root value inside <plist>
  while (tokens[i] && tokens[i].type === 'close') {
    i++;
  }
  return value();
}

/**
 * A property list in any format (XML, binary) as plain values. Binary ones
 * need plutil, which macOS has.
 */
export async function readPlist(buffer) {
  const head = buffer.subarray(0, 64).toString('utf8');
  if (head.includes('<?xml') || head.includes('<plist')) {
    return parseXmlPlist(buffer.toString('utf8'));
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vision-plist-'));
  try {
    const file = path.join(dir, 'Info.plist');
    await writeFile(file, buffer);
    const converted = await runTool('plutil', ['-convert', 'xml1', '-o', '-', file], {timeout: 10000});
    if (converted.missing) {
      throw new Error('Reading iOS builds needs plutil, which comes with macOS');
    }
    if (!converted.ok) {
      throw new Error(`Cannot read the property list: ${converted.stderr.trim()}`);
    }
    return parseXmlPlist(converted.stdout);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

/**
 * The property list inside a signed provisioning profile (embedded.mobileprovision):
 * the CMS envelope carries it as plain XML.
 */
export function parseProvisioningProfile(buffer) {
  const text = buffer.toString('latin1');
  const start = text.indexOf('<?xml');
  const end = text.indexOf('</plist>');
  if (start < 0 || end < 0) {
    return null;
  }
  return parseXmlPlist(Buffer.from(text.slice(start, end + '</plist>'.length), 'latin1').toString('utf8'));
}
