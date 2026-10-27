import {describe, expect, it} from 'vitest';

import {parseFootprint, parseLaunchctlPid, parseMacThreads, parsePsTime} from '../../app/common/shared/perf/parsers.js';
import {macCpuPercent} from '../../app/common/shared/perf/series.js';

const LAUNCHCTL = `PID\tStatus\tLabel
52509\t0\tUIKitApplication:com.apple.mobilecal[732f][rb-legacy]
57556\t0\tUIKitApplication:com.example.calculatorApp[d3a2][rb-legacy]
-\t0\tUIKitApplication:com.acme.wallet[aa11][rb-legacy]
52781\t0\tUIKitApplication:com.example.calculatorAppTests[8426][rb-legacy]
`;

describe('measuring an app on an iOS simulator', () => {
  it('finds the pid of the app, not of an app whose id starts the same', () => {
    expect(parseLaunchctlPid(LAUNCHCTL, 'com.example.calculatorApp')).toBe(57556);
    expect(parseLaunchctlPid(LAUNCHCTL, 'com.acme.wallet')).toBeNull();
    expect(parseLaunchctlPid(LAUNCHCTL, 'com.nothing')).toBeNull();
  });

  it('reads CPU time in every form ps prints it', () => {
    expect(parsePsTime(' 16:17.59')).toBeCloseTo(977.59);
    expect(parsePsTime('1:02:03.50')).toBeCloseTo(3723.5);
    expect(parsePsTime('2-01:00:00.00')).toBe(176400);
    expect(parsePsTime('')).toBeNull();
  });

  it('counts threads under the header of ps -M', () => {
    const output = [
      'USER         PID   TT   %CPU STAT PRI     STIME     UTIME COMMAND',
      'me         57556   ??    0.0 S     4T   0:00.17   0:00.30 Runner',
      '           57556         0.0 S     4T   0:00.00   0:00.00',
      '',
    ].join('\n');
    expect(parseMacThreads(output)).toBe(2);
  });

  it('reads the footprint in bytes', () => {
    expect(parseFootprint('Runner [57556]: 64-bit    Footprint: 102536704 B (16384 bytes per page)')).toBe(102536704);
    expect(parseFootprint('Runner [57556]: 64-bit    Footprint: 98 MB')).toBeNull();
  });

  it('counts CPU in % of all cores of the Mac, only for the same process', () => {
    const before = {pid: 7, at: 0, cpuSeconds: 10};
    expect(macCpuPercent(before, {pid: 7, at: 1000, cpuSeconds: 11}, 10)).toBe(10);
    expect(macCpuPercent(before, {pid: 8, at: 1000, cpuSeconds: 11}, 10)).toBeNull();
    expect(macCpuPercent(null, before, 10)).toBeNull();
  });
});
