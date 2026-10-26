import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';

import {findAll, parseAxml} from './axml.js';
import {parseProvisioningProfile, readPlist} from './plist.js';
import {withZip} from './zip.js';

export const BUILD_FORMATS = ['apk', 'aab', 'ipa', 'app'];

const ANDROID_LAUNCHER = 'android.intent.category.LAUNCHER';
const COMPONENT_TYPES = ['activity', 'activity-alias', 'service', 'receiver', 'provider'];

export class BuildError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const bool = (value) => value === true || value === 'true';
const int = (value) => (value === undefined || value === '' ? null : Number(value));

/**
 * What the rules and the screens need from an AndroidManifest.xml tree.
 */
export function summarizeAndroidManifest(root) {
  const sdk = findAll(root, 'uses-sdk')[0]?.attrs ?? {};
  const application = findAll(root, 'application')[0] ?? {attrs: {}, children: []};
  const packageName = String(root.attrs.package ?? '');
  const fullName = (name) => (String(name ?? '').startsWith('.') ? `${packageName}${name}` : String(name ?? ''));

  const components = COMPONENT_TYPES.flatMap((type) =>
    findAll(application, type).map((element) => {
      const filters = findAll(element, 'intent-filter');
      const actions = filters.flatMap((filter) => findAll(filter, 'action').map((a) => String(a.attrs.name ?? '')));
      const categories = filters.flatMap((filter) =>
        findAll(filter, 'category').map((c) => String(c.attrs.name ?? '')),
      );
      return {
        type,
        name: fullName(element.attrs.name),
        exported: element.attrs.exported === undefined ? null : bool(element.attrs.exported),
        permission: element.attrs.permission ? String(element.attrs.permission) : null,
        hasIntentFilter: filters.length > 0,
        launcher: categories.includes(ANDROID_LAUNCHER),
        actions,
      };
    }),
  );

  return {
    package: packageName,
    versionCode: int(root.attrs.versionCode),
    versionName: root.attrs.versionName === undefined ? '' : String(root.attrs.versionName),
    minSdk: int(sdk.minSdkVersion),
    targetSdk: int(sdk.targetSdkVersion),
    application: {
      debuggable: bool(application.attrs.debuggable),
      // allowBackup is on unless the app turns it off
      allowBackup: application.attrs.allowBackup === undefined ? true : bool(application.attrs.allowBackup),
      usesCleartextTraffic:
        application.attrs.usesCleartextTraffic === undefined ? null : bool(application.attrs.usesCleartextTraffic),
      networkSecurityConfig: application.attrs.networkSecurityConfig ?? null,
      testOnly: bool(application.attrs.testOnly),
    },
    permissions: findAll(root, 'uses-permission').map((p) => String(p.attrs.name ?? '')),
    components,
  };
}

/**
 * What the rules and the screens need from an Info.plist and the provisioning profile.
 */
export function summarizeIosApp(info, profile) {
  const ats = info.NSAppTransportSecurity ?? {};
  const exceptionDomains = Object.entries(ats.NSExceptionDomains ?? {}).map(([domain, settings]) => ({
    domain,
    insecureHttp: !!(
      settings?.NSExceptionAllowsInsecureHTTPLoads || settings?.NSTemporaryExceptionAllowsInsecureHTTPLoads
    ),
    minTls: settings?.NSExceptionMinimumTLSVersion ?? null,
  }));
  return {
    bundleId: info.CFBundleIdentifier ?? '',
    name: info.CFBundleDisplayName || info.CFBundleName || info.CFBundleIdentifier || '',
    version: info.CFBundleShortVersionString ?? '',
    build: info.CFBundleVersion ?? '',
    minOs: info.MinimumOSVersion ?? info.LSMinimumSystemVersion ?? '',
    platform: info.DTPlatformName ?? (info.CFBundleSupportedPlatforms ?? [])[0]?.toLowerCase() ?? '',
    ats: {
      arbitraryLoads: !!ats.NSAllowsArbitraryLoads,
      arbitraryLoadsInWebContent: !!ats.NSAllowsArbitraryLoadsInWebContent,
      exceptionDomains,
    },
    urlSchemes: (info.CFBundleURLTypes ?? []).flatMap((type) => type.CFBundleURLSchemes ?? []),
    fileSharing: !!info.UIFileSharingEnabled,
    openInPlace: !!info.LSSupportsOpeningDocumentsInPlace,
    backgroundModes: info.UIBackgroundModes ?? [],
    entitlements: profile?.Entitlements ?? {},
    profile: profile
      ? {
          name: profile.Name ?? '',
          team: profile.TeamName ?? '',
          expires: profile.ExpirationDate ?? null,
          devices: profile.ProvisionedDevices ?? null,
          allDevices: !!profile.ProvisionsAllDevices,
        }
      : null,
  };
}

/**
 * How a build is signed, in the words a tester uses.
 */
export function signingOf(platform, summary) {
  if (platform === 'android') {
    return summary.application.debuggable ? 'debug' : 'release';
  }
  if (summary.platform === 'iphonesimulator') {
    return 'simulator';
  }
  const {profile} = summary;
  if (!profile) {
    return 'unsigned';
  }
  if (profile.allDevices) {
    return 'enterprise';
  }
  if (profile.devices) {
    return summary.entitlements['get-task-allow'] ? 'development' : 'ad-hoc';
  }
  return 'app-store';
}

async function inspectApk(file) {
  return await withZip(file, async (zip) => {
    const entry = zip.find('AndroidManifest.xml');
    if (!entry) {
      throw new BuildError('notAnApk', 'The file has no AndroidManifest.xml');
    }
    const manifest = summarizeAndroidManifest(parseAxml(await zip.readEntry(entry)));
    const abis = [...new Set(zip.entries.map((e) => /^lib\/([^/]+)\//.exec(e.name)?.[1]).filter(Boolean))];
    return {
      platform: 'android',
      appId: manifest.package,
      name: manifest.package,
      version: manifest.versionName,
      build: manifest.versionCode === null ? '' : String(manifest.versionCode),
      minOs: manifest.minSdk === null ? '' : `API ${manifest.minSdk}`,
      target: 'any',
      abis,
      manifest,
    };
  });
}

function iosResult(info, profile) {
  const summary = summarizeIosApp(info, profile);
  return {
    platform: 'ios',
    appId: summary.bundleId,
    name: summary.name,
    version: summary.version,
    build: summary.build,
    minOs: summary.minOs ? `iOS ${summary.minOs}` : '',
    target: summary.platform === 'iphonesimulator' ? 'simulator' : 'device',
    manifest: summary,
  };
}

async function inspectIpa(file) {
  return await withZip(file, async (zip) => {
    const infoEntry = zip.find((e) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(e.name));
    if (!infoEntry) {
      throw new BuildError('notAnIpa', 'The file has no Payload/*.app/Info.plist');
    }
    const appDir = infoEntry.name.slice(0, -'Info.plist'.length);
    const profileEntry = zip.find(`${appDir}embedded.mobileprovision`);
    const info = await readPlist(await zip.readEntry(infoEntry));
    const profile = profileEntry ? parseProvisioningProfile(await zip.readEntry(profileEntry)) : null;
    return iosResult(info, profile);
  });
}

async function inspectAppDir(dir) {
  const info = await readPlist(await readFile(path.join(dir, 'Info.plist')));
  const profile = await readFile(path.join(dir, 'embedded.mobileprovision'))
    .then(parseProvisioningProfile)
    .catch(() => null);
  return iosResult(info, profile);
}

/**
 * Reads a build file: which app and version it is, what it runs on, how it
 * is signed, and its manifest or Info.plist for the rules.
 */
export async function inspectBuild(file) {
  const format = path.extname(file).slice(1).toLowerCase();
  if (!BUILD_FORMATS.includes(format)) {
    throw new BuildError('unknownFormat', `Not a build: ${path.basename(file)}`);
  }
  if (format === 'aab') {
    throw new BuildError('aabNeedsBundletool', 'An AAB is not installable as is: it needs bundletool to make APKs');
  }
  const stats = await stat(file);
  const details =
    format === 'apk' ? await inspectApk(file) : format === 'ipa' ? await inspectIpa(file) : await inspectAppDir(file);
  return {
    file,
    fileName: path.basename(file),
    format,
    size: stats.isDirectory() ? null : stats.size,
    ...details,
    signing: signingOf(details.platform, details.manifest),
  };
}
