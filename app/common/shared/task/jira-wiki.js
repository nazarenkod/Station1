// Jira's wiki markup (API v2) as plain blocks for the task card: headings,
// lists, code, paragraphs, and inline links and bold. What the card does not
// draw (colours, underline, images, panels) is dropped, its text kept.

const LINK = /\[([^\]|]*?)\|?(https?:\/\/[^\]\s]+)\]|(https?:\/\/[^\s<>"'\])|]+)/g;

// markup around text that the card shows as plain text
const strip = (text) =>
  String(text ?? '')
    .replace(/\{color(:[^}]*)?\}/g, '')
    .replace(/\{(panel|quote|noformat)(:[^}]*)?\}/g, '')
    .replace(/!([^!\s|]+)(\|[^!]*)?!/g, '')
    .replace(/\[~[^\]]+\]/g, '@')
    .replace(/(^|[\s(])\+([^+\n]+)\+(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/(^|[\s(])-([^-\n]+)-(?=[\s).,;:!?]|$)/g, '$1$2');

const cleanLabel = (label) => strip(label).replace(/\*/g, '').trim();

/**
 * A line as parts: text, bold text and links.
 * @returns {({text: string, bold?: boolean} | {text: string, url: string})[]}
 */
export function inlineParts(line) {
  const parts = [];
  const text = String(line ?? '');
  let at = 0;
  for (const match of text.matchAll(LINK)) {
    if (match.index > at) {
      parts.push(...boldParts(strip(text.slice(at, match.index))));
    }
    const url = match[2] ?? match[3];
    const label = match[2] ? cleanLabel(match[1]) : '';
    parts.push({text: label || shortUrl(url), url});
    at = match.index + match[0].length;
  }
  if (at < text.length) {
    parts.push(...boldParts(strip(text.slice(at))));
  }
  // where each part ends in the line names it for the card
  let end = 0;
  return parts
    .filter((part) => part.text)
    .map((part) => {
      end += part.text.length;
      return {...part, at: end};
    });
}

function boldParts(text) {
  const parts = [];
  let at = 0;
  for (const match of text.matchAll(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g)) {
    const start = match.index + match[1].length;
    if (start > at) {
      parts.push({text: text.slice(at, start)});
    }
    parts.push({text: match[2], bold: true});
    at = start + match[2].length + 2;
  }
  if (at < text.length) {
    parts.push({text: text.slice(at)});
  }
  return parts;
}

/** A long link as its site and the end of its path. */
export function shortUrl(url) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
    return `${parsed.hostname.replace(/^www\./, '')}${last ? `/…/${decodeURIComponent(last).slice(0, 40)}` : ''}`;
  } catch {
    return url;
  }
}

/**
 * The text of a description or comment as blocks.
 * @returns {{type: 'heading' | 'item' | 'code' | 'text' | 'rule', parts?: object[], text?: string, level?: number}[]}
 */
export function wikiBlocks(source) {
  const blocks = [];
  const lines = String(source ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const code = /^\{(code|noformat)(:[^}]*)?\}(.*)$/.exec(line.trim());
    if (code) {
      // {code}one line{code}
      const closed = /^(.*)\{(code|noformat)\}$/.exec(code[3]);
      if (closed) {
        blocks.push({type: 'code', text: closed[1]});
        continue;
      }
      const body = code[3] ? [code[3]] : [];
      while (++index < lines.length && !/^\{(code|noformat)\}/.test(lines[index].trim())) {
        body.push(lines[index]);
      }
      blocks.push({type: 'code', text: body.join('\n')});
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (/^-{4,}$/.test(trimmed)) {
      blocks.push({type: 'rule'});
      continue;
    }
    const heading = /^h([1-6])\.\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({type: 'heading', level: Number(heading[1]), parts: inlineParts(heading[2])});
      continue;
    }
    const item = /^([*#-]+)\s+(.*)$/.exec(trimmed);
    if (item) {
      blocks.push({type: 'item', level: item[1].length, parts: inlineParts(item[2])});
      continue;
    }
    const parts = inlineParts(trimmed.replace(/^bq\.\s+/, ''));
    if (parts.length) {
      blocks.push({type: 'text', parts});
    }
  }
  return blocks;
}
