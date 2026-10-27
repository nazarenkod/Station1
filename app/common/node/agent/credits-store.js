import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {appendLedger, ledgerEntry, summarizeCredits} from '../../shared/agent/credits.js';

/**
 * The credits ledger in a file of the station's folder: a turn a line of a
 * JSON list, kept on this Mac only.
 */
export function createCreditsStore(file) {
  let ledger = null;

  const load = async () => {
    if (!ledger) {
      try {
        ledger = JSON.parse(await readFile(file, 'utf8'));
      } catch {
        ledger = [];
      }
    }
    return ledger;
  };

  return {
    async add(turn) {
      ledger = appendLedger(await load(), ledgerEntry(turn));
      await mkdir(path.dirname(file), {recursive: true});
      await writeFile(file, JSON.stringify(ledger)).catch(() => null);
      return ledger.at(-1);
    },
    async summary(now = new Date()) {
      return summarizeCredits(await load(), now);
    },
  };
}
