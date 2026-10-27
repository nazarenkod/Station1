import {z} from 'zod';

import {maskText} from '../../shared/agent/privacy.js';
import {rowForAgent, statsForAgent, valueForAgent} from '../../shared/app-data/agent.js';

// The app's data for the agent: what is stored and what changed, read only.
// A token, a password or a session never comes back, only that it is there.

const TEXT_LIMIT = 4000;
const ROWS_LIMIT = 20;
const CHANGES_LIMIT = 30;

/**
 * @param {object} deps
 * @param {ReturnType<import('../app-data/service.js').createAppDataService>} deps.service
 * @param {() => Promise<RegExp[]>} deps.masks
 * @param {() => number} [deps.now]
 */
export function appDataTools({service, masks, now = () => Date.now()}) {
  // a read happens once, when the agent asks before the tab was opened
  const snapshot = async () => {
    const state = service.state();
    if (state.snapshot) {
      return state.snapshot;
    }
    try {
      return (await service.refresh()).snapshot;
    } catch {
      return null;
    }
  };

  return [
    {
      name: 'app_data_stats',
      readOnly: true,
      description:
        'What the app on the device stores, without values: preference files with their keys and types, SQLite databases with tables and row counts, the biggest files. Call it before app_data_get.',
      input: {},
      run: async () => statsForAgent(await snapshot()),
    },
    {
      name: 'app_data_search',
      readOnly: true,
      description:
        'Finds a text in all the app’s data at once: keys and values of preferences, rows of databases, file names and text files. Secrets come back hidden.',
      input: {query: z.string().describe('An id, an email, a key name…')},
      run: async ({query}) => {
        if (!(await snapshot())) {
          return {error: 'The app’s data cannot be read now.'};
        }
        const patterns = await masks();
        const found = await service.search(query);
        return {
          prefs: found.prefs.slice(0, ROWS_LIMIT).map((one) => ({
            file: one.file,
            key: one.key,
            value: valueForAgent(one.key, one.value.text, patterns, now()),
          })),
          rows: found.rows.slice(0, ROWS_LIMIT).map((one) => ({
            file: one.file,
            table: one.table,
            column: one.column,
            key: one.key,
            value: valueForAgent(one.column, one.value.text, patterns, now()),
          })),
          files: found.files.slice(0, ROWS_LIMIT).map((one) => one.path),
          texts: found.texts
            .slice(0, ROWS_LIMIT)
            .map((one) => ({path: one.path, line: one.line, text: maskText(one.text, patterns)})),
        };
      },
    },
    {
      name: 'app_data_get',
      readOnly: true,
      description:
        'Values from one place: a preference file (all keys, or one with key), a database table (rows, with offset), or a text file. Secrets come back hidden.',
      input: {
        file: z.string().describe('The path from app_data_stats'),
        key: z.string().optional().describe('One key of a preference file'),
        table: z.string().optional().describe('A table of a database'),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().max(ROWS_LIMIT).optional(),
      },
      run: async ({file, key, table, offset = 0, limit = ROWS_LIMIT}) => {
        const data = await snapshot();
        if (!data) {
          return {error: 'The app’s data cannot be read now.'};
        }
        const patterns = await masks();
        const prefs = data.prefs.find((one) => one.file === file);
        if (prefs) {
          if (prefs.encrypted) {
            return {file, encrypted: true, keys: prefs.entries.length};
          }
          const entries = key ? prefs.entries.filter((entry) => entry.key === key) : prefs.entries;
          if (key && !entries.length) {
            return {error: `No key ${key} in ${file}`};
          }
          return {
            file,
            entries: entries.slice(0, 100).map((entry) => ({
              key: entry.key,
              type: entry.type,
              value: valueForAgent(entry.key, entry.value, patterns, now()),
            })),
          };
        }
        if (data.dbs.some((one) => one.file === file)) {
          if (!table) {
            return {error: 'Name a table; app_data_stats lists them.'};
          }
          const page = await service.table(file, table, {offset, limit});
          return {
            file,
            table,
            total: page.total,
            offset,
            rows: page.rows.map((row) => rowForAgent(row, patterns, now())),
          };
        }
        const content = await service.fileContent(file);
        if (content.text === undefined) {
          return {file, kind: content.kind, size: content.size, note: 'Not a text file; its content is not given.'};
        }
        const text = maskText(content.text, patterns);
        return {
          file,
          kind: content.kind,
          text: text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}… (cut, ${text.length} chars)` : text,
        };
      },
    },
    {
      name: 'app_data_changes',
      readOnly: true,
      description:
        'What changed in the app’s data while the data tab watched, newest first, with the screen it happened on. Use it to check that a step saved, changed or cleared something.',
      input: {limit: z.number().int().positive().max(CHANGES_LIMIT).optional()},
      run: async ({limit = CHANGES_LIMIT}) => {
        const patterns = await masks();
        const {changes, watching} = service.state();
        const hide = (name, value) =>
          value && typeof value === 'object' && !Array.isArray(value)
            ? rowForAgent(value, patterns, now())
            : valueForAgent(name, value, patterns, now());
        return {
          watching,
          changes: changes.slice(0, limit).map((change) => ({
            at: new Date(change.at).toISOString(),
            screen: change.screen ?? undefined,
            kind: change.kind,
            section: change.section,
            file: change.file,
            key: change.key ?? undefined,
            table: change.table ?? undefined,
            before: change.before === undefined ? undefined : hide(change.key, change.before),
            after: change.after === undefined ? undefined : hide(change.key, change.after),
          })),
        };
      },
    },
  ];
}
