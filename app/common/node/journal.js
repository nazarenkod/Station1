import {createWriteStream} from 'node:fs';
import {mkdir, readFile, rename, rm} from 'node:fs/promises';
import path from 'node:path';

import {createJournal, redact} from '../shared/journal.js';

const CURRENT = 'current.jsonl';
const PREVIOUS = 'previous.jsonl';
const FILE_LIMIT = 20 * 1024 * 1024;

// IPC channels that are asked all the time and tell nothing
const QUIET_CHANNELS = new Set(['settings:get', 'settings:has']);

/** The journal of this process: the station, or the CLI (in memory only). */
export const journal = createJournal();

let summary = {startedAt: Date.now()};
let file = null;
let fileSize = 0;

const write = (record) => {
  if (!file) {
    return;
  }
  const line = `${JSON.stringify(record)}\n`;
  fileSize += Buffer.byteLength(line);
  if (fileSize <= FILE_LIMIT) {
    file.write(line);
  }
};

journal.subscribe((entry) => entry && write({entry}));

/**
 * Adds to the summary of this run: the app, the OS, the shell and its PATH.
 */
export function setSummary(patch) {
  summary = {...summary, ...patch};
  write({summary});
}

export const getSummary = () => summary;

/**
 * Starts the file of this run in `dir`; the file of the run before becomes
 * the previous one, so a run that hung can be read after a restart.
 */
export async function startJournalFile(dir) {
  await mkdir(dir, {recursive: true});
  await rm(path.join(dir, PREVIOUS), {force: true});
  await rename(path.join(dir, CURRENT), path.join(dir, PREVIOUS)).catch(() => {});
  file = createWriteStream(path.join(dir, CURRENT), {flags: 'w'});
  fileSize = 0;
  write({summary});
  for (const entry of journal.list()) {
    write({entry});
  }
}

/**
 * Reads a journal file back: the last summary and every record in its last
 * state (a record written when it started and never again did not finish).
 */
export function parseJournalFile(text) {
  let fileSummary = null;
  const byId = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const record = JSON.parse(line);
      if (record.summary) {
        fileSummary = record.summary;
      } else if (record.entry) {
        byId.set(record.entry.id, record.entry);
      }
    } catch {
      // a line cut by a crash
    }
  }
  return {summary: fileSummary, entries: [...byId.values()].sort((a, b) => a.id - b.id)};
}

export async function readPreviousJournal(dir) {
  try {
    return parseJournalFile(await readFile(path.join(dir, PREVIOUS), 'utf8'));
  } catch {
    return null;
  }
}

const sourceForChannel = (channel) =>
  channel.startsWith('proxy:') ? 'proxy' : channel.startsWith('doctor:server:') ? 'appium' : 'ipc';

/**
 * Wraps an IPC handler so the journal tells each call: the channel, how long
 * it took and how it ended. Arguments and answers are not kept.
 */
export function trackHandler(channel, handler, target = journal) {
  if (QUIET_CHANNELS.has(channel) || channel.startsWith('journal:')) {
    return handler;
  }
  const source = sourceForChannel(channel);
  return async (...args) => {
    const id = target.begin({source, text: channel});
    try {
      const result = await handler(...args);
      // several handlers answer {ok: false, error} instead of throwing
      const failed = result && typeof result === 'object' && result.ok === false;
      target.end(id, {
        level: failed ? 'warn' : 'debug',
        ...(failed && result.error ? {detail: redact(String(result.error))} : {}),
      });
      return result;
    } catch (error) {
      target.end(id, {level: 'error', detail: error?.stack || String(error)});
      throw error;
    }
  };
}
