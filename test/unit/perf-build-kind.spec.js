import {describe, expect, it} from 'vitest';

import {androidBuildKind, iosBuildKind} from '../../app/common/shared/perf/parsers.js';

const plist = (body) =>
  `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>${body}</dict></plist>`;

describe('telling a debug build from a release one', () => {
  it('reads DEBUGGABLE from dumpsys package', () => {
    expect(androidBuildKind('    flags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP ]')).toBe('debug');
    expect(androidBuildKind('    pkgFlags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]')).toBe('release');
    expect(androidBuildKind('Unable to find package')).toBe('unknown');
  });

  it('reads get-task-allow from the entitlements of a simulator or a device build', () => {
    expect(iosBuildKind(plist('<key>com.apple.security.get-task-allow</key><true/>'))).toBe('debug');
    expect(iosBuildKind(plist('<key>get-task-allow</key><true/>'))).toBe('debug');
    expect(iosBuildKind(plist('<key>get-task-allow</key><false/>'))).toBe('release');
    expect(iosBuildKind(plist('<key>application-identifier</key><string>X.com.acme</string>'))).toBe('release');
    expect(iosBuildKind('')).toBe('unknown');
  });
});
