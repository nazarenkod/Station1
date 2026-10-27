import {describe, expect, it} from 'vitest';

import {
  androidCpuProbeCommand,
  isAppId,
  parseAndroidCpuProbe,
  parseMeminfo,
  parsePidStat,
  parseProcStatTotal,
} from '../../app/common/shared/perf/parsers.js';
import {androidCpuPercent} from '../../app/common/shared/perf/series.js';

// /proc/<pid>/stat of a Flutter app: the name holds a space, utime 1200, stime 300, 42 threads
const stat = (pid, utime, stime, threads = 42, name = 'ui thread') =>
  `${pid} (${name}) S 612 612 0 0 -1 1077952832 81255 0 1 0 ${utime} ${stime} 0 0 10 -10 ${threads} 0 2153 0 0`;

const MEMINFO_10 = `Applications Memory Usage (in Kilobytes):
Uptime: 6519473 Realtime: 6519473

** MEMINFO in pid 13410 [com.acme.wallet] **
                   Pss  Private  Private  SwapPss      Rss     Heap     Heap     Heap
                 Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free
                ------   ------   ------   ------   ------   ------   ------   ------
  Native Heap    30123    30060        0        0    31680    45056    38912     6143
  Dalvik Heap     8456     8400        0        0    14916    13018     6509     6509

 App Summary
                       Pss(KB)                        Rss(KB)
                        ------                         ------
           Java Heap:    10872                          24496
         Native Heap:    30060                          31680
                Code:    21480                          71572
               Stack:     1316                           1324
            Graphics:    40052                          40052
       Private Other:     9628
              System:     6913
             Unknown:                                    3340

           TOTAL PSS:   120321            TOTAL RSS:   172464       TOTAL SWAP PSS:      102
`;

const MEMINFO_9 = ` App Summary
                       Pss(KB)
                        ------
           Java Heap:     5000
         Native Heap:     6000
            Graphics:     7000

               TOTAL:    20000       TOTAL SWAP PSS:       12
`;

describe('measuring an Android app', () => {
  it('reads the time of all cores from the first line of /proc/stat', () => {
    expect(parseProcStatTotal('cpu  100 20 30 400 5 6 7 8 99 99')).toBe(576);
    expect(parseProcStatTotal('intr 1 2 3')).toBeNull();
  });

  it('reads CPU ticks and threads of a process, even with spaces in its name', () => {
    expect(parsePidStat(stat(13410, 1200, 300))).toEqual({pid: 13410, ticks: 1500, threads: 42});
    expect(parsePidStat('garbage')).toBeNull();
  });

  it('reads the probe of all the processes of the app', () => {
    const probe = parseAndroidCpuProbe(
      [
        `cpu  1000 0 0 9000 0 0 0 0`,
        `P 13410 ${stat(13410, 100, 50)}`,
        `P 13502 ${stat(13502, 10, 5, 9, 'remote')}`,
        '',
      ].join('\n'),
    );
    expect(probe.total).toBe(10000);
    expect(probe.processes.map((process) => process.pid)).toEqual([13410, 13502]);
  });

  it('counts CPU of all processes in % of all cores, a new process from its next probe', () => {
    const before = {total: 10000, processes: [{pid: 1, ticks: 100, threads: 10}]};
    const after = {
      total: 10400,
      processes: [
        {pid: 1, ticks: 140, threads: 10},
        {pid: 2, ticks: 900, threads: 4},
      ],
    };
    expect(androidCpuPercent(before, after)).toBe(10);
    expect(androidCpuPercent(null, after)).toBeNull();
    expect(androidCpuPercent(after, {...after})).toBeNull();
  });

  it('reads PSS in total and by part on Android 10+ and older', () => {
    const memory = parseMeminfo(MEMINFO_10);
    expect(memory.total).toBe(120321 * 1024);
    expect(memory.parts).toMatchObject({java: 10872 * 1024, native: 30060 * 1024, graphics: 40052 * 1024});
    expect(parseMeminfo(MEMINFO_9).total).toBe(20000 * 1024);
    expect(parseMeminfo('No process found for: com.acme.wallet')).toBeNull();
  });

  it('puts only a package name into the device shell', () => {
    expect(isAppId('com.acme.wallet')).toBe(true);
    expect(isAppId('com.acme; rm -rf /')).toBe(false);
    expect(androidCpuProbeCommand('com.acme.wallet')).toContain('"com.acme.wallet:"');
    expect(() => androidCpuProbeCommand('$(reboot)')).toThrow('not a package name');
  });
});
