import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {runTool} from '../doctor/exec.js';

// Property lists on iOS are binary; the station reads and writes XML. plutil,
// which macOS has, converts between them.

async function convert(bytes, format) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vision-plist-'));
  try {
    const file = path.join(dir, 'file.plist');
    await writeFile(file, bytes);
    const result = await runTool('plutil', ['-convert', format, file], {timeout: 10000, quiet: true});
    if (!result.ok) {
      throw new Error(`plutil: ${(result.stderr || result.stdout).trim()}`);
    }
    return await readFile(file);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

const isXml = (bytes) => /^\s*<\?xml|^\s*<plist/.test(Buffer.from(bytes).subarray(0, 64).toString('utf8'));

/** A property list in any format as XML text. */
export async function plistToXml(bytes) {
  return isXml(bytes) ? Buffer.from(bytes).toString('utf8') : (await convert(bytes, 'xml1')).toString('utf8');
}

/** An XML property list as the binary one iOS writes. */
export async function xmlToBinaryPlist(xml) {
  return await convert(Buffer.from(xml, 'utf8'), 'binary1');
}
