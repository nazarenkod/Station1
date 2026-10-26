// Device log lines turned into entries every tool understands:
// {time, pid, tid, level, tag, message}. Levels are logcat's letters:
// V D I W E F.

const LOGCAT_THREADTIME = /^(\d\d-\d\d)\s+(\d\d:\d\d:\d\d\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEFS])\s+(.*?)\s*: ?(.*)$/;

/**
 * One line of `adb logcat -v threadtime`, or null for the "--------- beginning
 * of main" separators and anything else that is not an entry.
 */
export function parseLogcatLine(line) {
  const match = LOGCAT_THREADTIME.exec(line);
  if (!match) {
    return null;
  }
  const [, date, time, pid, tid, level, tag, message] = match;
  return {
    date,
    time,
    pid: Number(pid),
    tid: Number(tid),
    level: level === 'S' ? 'V' : level,
    tag: tag.trim(),
    message,
  };
}

/**
 * logcat prints a multi-line message (a stack trace) as many lines with the
 * same header. This joins them back into one entry; `push` returns the entry
 * that is complete once a different line arrives.
 */
export class LogcatJoiner {
  constructor() {
    this.pending = null;
  }

  push(line) {
    const entry = parseLogcatLine(line);
    if (!entry) {
      return null;
    }
    const p = this.pending;
    if (
      p &&
      p.pid === entry.pid &&
      p.tid === entry.tid &&
      p.level === entry.level &&
      p.tag === entry.tag &&
      p.time === entry.time &&
      p.date === entry.date
    ) {
      p.message += `\n${entry.message}`;
      return null;
    }
    this.pending = entry;
    return p;
  }

  flush() {
    const p = this.pending;
    this.pending = null;
    return p;
  }
}

const IOS_LEVELS = {Debug: 'D', Info: 'I', Default: 'I', Notice: 'I', Warning: 'W', Error: 'E', Fault: 'F'};

const basename = (file) => (file ? String(file).split('/').pop() : '');

/**
 * One line of `log stream --style ndjson` (a simulator's unified log).
 */
export function parseIosNdjsonLine(line) {
  if (!line.startsWith('{')) {
    return null;
  }
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (!event.eventMessage && event.eventMessage !== '') {
    return null;
  }
  // 2026-10-26 14:25:45.301234+0300
  const stamp = /^(\d{4})-(\d\d)-(\d\d) (\d\d:\d\d:\d\d\.\d{3})/.exec(event.timestamp ?? '');
  return {
    date: stamp ? `${stamp[2]}-${stamp[3]}` : '',
    time: stamp ? stamp[4] : '',
    pid: Number(event.processID ?? 0),
    tid: Number(event.threadID ?? 0),
    level: IOS_LEVELS[event.messageType] ?? 'I',
    tag: event.category || event.subsystem || basename(event.senderImagePath),
    process: basename(event.processImagePath),
    message: event.eventMessage,
  };
}

const MONTHS = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};
const IDEVICESYSLOG =
  /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d\d:\d\d:\d\d)(\.\d+)?\s+\S+\s+([^[(\s]+)(?:\(([^)]*)\))?\[(\d+)\]\s+<(\w+)>:\s?(.*)$/;

/**
 * One line of `idevicesyslog` (a real iPhone through libimobiledevice).
 */
export function parseIdevicesyslogLine(line) {
  const match = IDEVICESYSLOG.exec(line);
  if (!match) {
    return null;
  }
  const [, month, day, time, fraction, process, library, pid, level, message] = match;
  return {
    date: `${MONTHS[month] ?? '00'}-${day.padStart(2, '0')}`,
    time: `${time}${(fraction ?? '.000').slice(0, 4).padEnd(4, '0')}`,
    pid: Number(pid),
    tid: 0,
    level: IOS_LEVELS[level] ?? 'I',
    tag: library || process,
    process,
    message,
  };
}
