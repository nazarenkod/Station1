import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {buildsInEntries} from '../../app/common/node/builds/artifacts.js';
import {inspectBuild, signingOf, summarizeIosApp} from '../../app/common/node/builds/inspect.js';
import {parseAdbInstall} from '../../app/common/node/builds/install.js';
import {parseProvisioningProfile, parseXmlPlist} from '../../app/common/node/builds/plist.js';
import {compatibility} from '../../app/common/shared/builds/compatibility.js';
import {failsAt, makeFinding} from '../../app/common/shared/findings/findings.js';
import {checkManifest} from '../../app/common/shared/findings/manifest-rules.js';

// the manifest of Appium's io.appium.settings 5.0.3 (Apache-2.0), zipped alone
const SETTINGS_APK = path.join(import.meta.dirname, '../fixtures/builds/appium-settings.apk');

const rulesOf = (findings) => findings.map((finding) => finding.rule);

describe('reading an APK', () => {
  it('reads the app, version, SDK levels and signing from the binary manifest', async () => {
    const build = await inspectBuild(SETTINGS_APK);
    expect(build).toMatchObject({
      platform: 'android',
      format: 'apk',
      appId: 'io.appium.settings',
      version: '5.0.3',
      build: '55',
      minOs: 'API 21',
      signing: 'debug',
    });
    expect(build.manifest.targetSdk).toBe(30);
    expect(build.manifest.application).toMatchObject({debuggable: true, allowBackup: false});
    expect(build.manifest.permissions).toContain('android.permission.READ_SMS');
    const launcher = build.manifest.components.find((c) => c.launcher);
    expect(launcher).toMatchObject({type: 'activity', name: 'io.appium.settings.Settings'});
  });

  it('flags what the manifest gets wrong, and not the launcher activity', async () => {
    const findings = checkManifest(await inspectBuild(SETTINGS_APK));
    expect(new Set(rulesOf(findings))).toEqual(
      new Set(['android-debuggable', 'android-exported', 'android-target-sdk', 'android-dangerous-permissions']),
    );
    const exported = findings.filter((f) => f.rule === 'android-exported').map((f) => f.subject);
    expect(exported).toContain('io.appium.settings.receivers.SmsReader');
    expect(exported).not.toContain('io.appium.settings.Settings');
    // services guarded by a permission are fine
    expect(exported).not.toContain('io.appium.settings.LocationService');
  });

  it('lets a project turn rules off and change their numbers', async () => {
    const build = await inspectBuild(SETTINGS_APK);
    const findings = checkManifest(build, {
      'android-exported': {enabled: false},
      'android-target-sdk': {minTargetSdk: 30},
      'android-debuggable': {severity: 'info'},
    });
    expect(rulesOf(findings)).not.toContain('android-exported');
    expect(rulesOf(findings)).not.toContain('android-target-sdk');
    expect(findings.find((f) => f.rule === 'android-debuggable').severity).toBe('info');
  });

  it('keeps finding ids stable for the same app, rule and subject', async () => {
    const build = await inspectBuild(SETTINGS_APK);
    expect(checkManifest(build).map((f) => f.id)).toEqual(checkManifest(build).map((f) => f.id));
    const a = makeFinding({tool: 'builds', rule: 'r', severity: 'high', subject: 's', scope: 'app.one'});
    const b = makeFinding({tool: 'builds', rule: 'r', severity: 'low', subject: 's', scope: 'app.two'});
    expect(a.id).toMatch(/^builds-[0-9a-f]{8}$/);
    expect(a.id).not.toBe(b.id);
  });

  it('refuses files that are not builds', async () => {
    await expect(inspectBuild('notes.txt')).rejects.toMatchObject({code: 'unknownFormat'});
    await expect(inspectBuild('app-release.aab')).rejects.toMatchObject({code: 'aabNeedsBundletool'});
  });
});

describe('iOS apps', () => {
  const info = {
    CFBundleIdentifier: 'com.acme.wallet',
    CFBundleDisplayName: 'Wallet',
    CFBundleShortVersionString: '3.42.0',
    CFBundleVersion: '1287',
    MinimumOSVersion: '15.0',
    DTPlatformName: 'iphoneos',
    NSAppTransportSecurity: {
      NSAllowsArbitraryLoads: true,
      NSExceptionDomains: {'legacy.acme.io': {NSExceptionAllowsInsecureHTTPLoads: true}, 'api.acme.io': {}},
    },
    CFBundleURLTypes: [{CFBundleURLSchemes: ['acmewallet']}],
    UIFileSharingEnabled: true,
  };
  const profile = {
    Name: 'Wallet Ad Hoc',
    ExpirationDate: '2026-11-02T10:00:00Z',
    ProvisionedDevices: ['00008110-AAAA'],
    Entitlements: {'get-task-allow': false},
  };
  const now = Date.parse('2026-10-26T10:00:00Z');
  const build = {platform: 'ios', appId: 'com.acme.wallet', target: 'device', manifest: summarizeIosApp(info, profile)};

  it('reads ATS, deep links, file sharing and the profile', () => {
    expect(build.manifest.ats.exceptionDomains).toEqual([
      {domain: 'legacy.acme.io', insecureHttp: true, minTls: null},
      {domain: 'api.acme.io', insecureHttp: false, minTls: null},
    ]);
    expect(signingOf('ios', build.manifest)).toBe('ad-hoc');
  });

  it('flags insecure transport, file sharing, deep links and a profile about to expire', () => {
    const findings = checkManifest(build, {}, now);
    expect(rulesOf(findings)).toEqual([
      'ios-ats-arbitrary-loads',
      'ios-ats-insecure-domain',
      'ios-file-sharing',
      'ios-profile-expiring',
      'ios-url-schemes',
    ]);
    expect(findings.find((f) => f.rule === 'ios-profile-expiring').params.days).toBe(7);
    expect(failsAt(findings, 'high')).toBe(true);
    expect(
      failsAt(
        findings.filter((f) => f.severity !== 'high'),
        'high',
      ),
    ).toBe(false);
  });

  it('tells which devices a build can go on', () => {
    const simulator = {kind: 'ios-simulator', id: 'SIM'};
    const listed = {kind: 'ios-device', id: '00008110-AAAA'};
    const other = {kind: 'ios-device', id: '00008110-BBBB'};
    const pixel = {kind: 'android-emulator', id: 'emulator-5554'};
    expect(compatibility(build, listed)).toEqual({ok: true});
    expect(compatibility(build, other)).toEqual({ok: false, reason: 'notProvisioned'});
    expect(compatibility(build, simulator)).toEqual({ok: false, reason: 'deviceBuildOnSimulator'});
    expect(compatibility(build, pixel)).toEqual({ok: false, reason: 'wrongPlatform'});
  });
});

describe('property lists', () => {
  it('parses XML plists with every value type', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Name</key><string>A &amp; B</string>
  <key>Count</key><integer>3</integer>
  <key>Ratio</key><real>1.5</real>
  <key>On</key><true/>
  <key>Off</key><false/>
  <key>List</key><array><string>x</string><dict/></array>
  <key>Empty</key><string></string>
  <key>When</key><date>2026-11-02T10:00:00Z</date>
</dict></plist>`;
    expect(parseXmlPlist(xml)).toEqual({
      Name: 'A & B',
      Count: 3,
      Ratio: 1.5,
      On: true,
      Off: false,
      List: ['x', {}],
      Empty: '',
      When: '2026-11-02T10:00:00Z',
    });
  });

  it('finds the plist inside a signed provisioning profile', () => {
    const plist = '<?xml version="1.0"?><plist><dict><key>Name</key><string>Dev</string></dict></plist>';
    const signed = Buffer.concat([
      Buffer.from([0x30, 0x82, 0x01, 0x00]),
      Buffer.from(plist),
      Buffer.from([0xa0, 0x00]),
    ]);
    expect(parseProvisioningProfile(signed)).toEqual({Name: 'Dev'});
  });
});

describe('installing', () => {
  it('explains why adb refused a build', () => {
    expect(parseAdbInstall({ok: true, stdout: 'Performing Streamed Install\nSuccess\n', stderr: ''})).toEqual({
      ok: true,
    });
    const mismatch = parseAdbInstall({
      ok: false,
      stdout: 'Performing Streamed Install\n',
      stderr:
        'adb: failed to install app.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.acme.wallet signatures do not match newer version; ignoring!]',
    });
    expect(mismatch).toMatchObject({
      ok: false,
      reason: 'signatureMismatch',
      code: 'INSTALL_FAILED_UPDATE_INCOMPATIBLE',
    });
    expect(parseAdbInstall({ok: false, stdout: '', stderr: 'adb: device offline'})).toMatchObject({
      ok: false,
      reason: 'failed',
      error: 'adb: device offline',
    });
  });

  it('finds builds inside GitLab artifacts', () => {
    const names = [
      'build/outputs/apk/debug/app-debug.apk',
      'build/outputs/mapping.txt',
      'ios/Build/Products/Debug-iphonesimulator/Wallet.app/Info.plist',
      'ios/Build/Products/Debug-iphonesimulator/Wallet.app/Wallet',
      'ios/Build/Products/Debug-iphonesimulator/Wallet.app/PlugIns/Widget.appex/Info.plist',
      'ios/Build/Products/Debug-iphonesimulator/Wallet.app/Frameworks/Kit.framework/Info.plist',
      'dist/Wallet.ipa',
    ];
    expect(buildsInEntries(names)).toEqual([
      {entry: 'build/outputs/apk/debug/app-debug.apk', name: 'app-debug.apk', folder: false},
      {entry: 'dist/Wallet.ipa', name: 'Wallet.ipa', folder: false},
      {entry: 'ios/Build/Products/Debug-iphonesimulator/Wallet.app', name: 'Wallet.app', folder: true},
    ]);
  });
});
