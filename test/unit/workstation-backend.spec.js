import {describe, expect, it} from 'vitest';

import {
  parseAndroidVersion,
  parseDevicectlApps,
  parsePmPackages,
  parseResumedPackage,
  parseSimctlApps,
} from '../../app/common/node/device/apps.js';
import {GitLabService} from '../../app/common/node/gitlab/service.js';
import {JiraBugService} from '../../app/common/node/jira/bug-service.js';

describe('apps on a device', () => {
  it('reads package names from pm list packages', () => {
    const output = 'package:com.acme.wallet\r\npackage:org.example.notes\n\nnot a package\n';
    expect(parsePmPackages(output)).toEqual(['com.acme.wallet', 'org.example.notes']);
  });

  it('finds the app on screen whatever Android calls the line', () => {
    const android14 =
      '  topResumedActivity=ActivityRecord{8a1c2f1 u0 com.acme.wallet/.home.MainActivity t42}\n  mFocusedApp=...';
    const android9 = '    mResumedActivity: ActivityRecord{3b4d u0 com.acme.wallet/com.acme.wallet.Splash t7}';
    expect(parseResumedPackage(android14)).toBe('com.acme.wallet');
    expect(parseResumedPackage(android9)).toBe('com.acme.wallet');
    expect(parseResumedPackage('nothing resumed')).toBeNull();
  });

  it('reads the version name and code', () => {
    const output =
      'Packages:\n  Package [com.acme.wallet]\n    versionCode=1287 minSdk=26 targetSdk=34\n    versionName=3.42.0\n';
    expect(parseAndroidVersion(output)).toEqual({version: '3.42.0', build: '1287'});
  });

  it('keeps only user apps of a simulator', () => {
    const json = {
      'com.apple.Preferences': {ApplicationType: 'System', CFBundleIdentifier: 'com.apple.Preferences'},
      'com.acme.wallet': {
        ApplicationType: 'User',
        CFBundleIdentifier: 'com.acme.wallet',
        CFBundleDisplayName: 'Wallet',
        CFBundleShortVersionString: '3.41.2',
        CFBundleVersion: '1270',
      },
    };
    expect(parseSimctlApps(json)).toEqual([{id: 'com.acme.wallet', name: 'Wallet', version: '3.41.2', build: '1270'}]);
  });

  it('keeps apps a person installed on an iPhone', () => {
    const json = {
      result: {
        apps: [
          {bundleIdentifier: 'com.apple.mobilesafari', name: 'Safari', removable: false},
          {
            bundleIdentifier: 'com.acme.wallet',
            name: 'Wallet',
            version: '3.42.0',
            bundleVersion: '1287',
            removable: true,
          },
          {bundleIdentifier: 'com.acme.clip', name: 'Clip', appClip: true},
        ],
      },
    };
    expect(parseDevicectlApps(json)).toEqual([
      {id: 'com.acme.wallet', name: 'Wallet', version: '3.42.0', build: '1287'},
    ]);
  });
});

describe('GitLab', () => {
  const answer = (body, status = 200) => ({ok: status < 400, status, json: async () => body});

  it('says who the token belongs to and finds the project', async () => {
    const calls = [];
    const service = new GitLabService({
      getSettings: async () => ({url: 'https://gitlab.acme.io/', project: 'mobile/wallet-android'}),
      getToken: async () => 'glpat-secret',
      fetchImpl: async (url, init) => {
        calls.push({url, token: init.headers['PRIVATE-TOKEN']});
        return url.endsWith('/user')
          ? answer({name: 'Olena K.', username: 'olena'})
          : answer({path_with_namespace: 'mobile/wallet-android'});
      },
    });
    expect(await service.test()).toEqual({ok: true, user: 'Olena K.', project: 'mobile/wallet-android'});
    expect(calls).toEqual([
      {url: 'https://gitlab.acme.io/api/v4/user', token: 'glpat-secret'},
      {url: 'https://gitlab.acme.io/api/v4/projects/mobile%2Fwallet-android', token: 'glpat-secret'},
    ]);
  });

  it('explains a rejected token', async () => {
    const service = new GitLabService({
      getSettings: async () => ({url: 'https://gitlab.acme.io'}),
      getToken: async () => 'glpat-old',
      fetchImpl: async () => answer({}, 401),
    });
    expect(await service.test()).toEqual({ok: false, error: 'GitLab answered: the token is wrong or expired'});
  });

  it('asks to be set up before calling anything', async () => {
    const service = new GitLabService({
      getSettings: async () => ({url: 'https://gitlab.acme.io'}),
      getToken: async () => null,
      fetchImpl: async () => {
        throw new Error('must not be called');
      },
    });
    const result = await service.test();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not set up/);
  });
});

describe('my bugs in Jira', () => {
  it('lists what the account reported, newest first, with the status category', async () => {
    let jql = '';
    const service = new JiraBugService({
      getSettings: async () => ({url: 'https://acme.atlassian.net', email: 'qa@acme.com'}),
      getToken: async () => 'token',
      fetchImpl: async (url) => {
        jql = decodeURIComponent(/jql=([^&]+)/.exec(url)[1]);
        const body = {
          issues: [
            {
              key: 'VIS-1423',
              fields: {
                summary: '502 on transfer confirmation',
                status: {name: 'In Progress', statusCategory: {key: 'indeterminate'}},
                labels: [],
              },
            },
          ],
        };
        return {ok: true, status: 200, text: async () => JSON.stringify(body)};
      },
    });
    const result = await service.mine();
    expect(jql).toBe('reporter = currentUser() ORDER BY updated DESC');
    expect(result.ok).toBe(true);
    expect(result.issues[0]).toMatchObject({
      key: 'VIS-1423',
      status: 'In Progress',
      category: 'indeterminate',
      done: false,
    });
  });

  it('reports a missing setup instead of throwing', async () => {
    const service = new JiraBugService({getSettings: async () => ({}), getToken: async () => null});
    const result = await service.mine();
    expect(result.ok).toBe(false);
  });
});

describe('an iPhone the Mac cannot talk to', () => {
  it('says when Xcode is too old for the iPhone', async () => {
    const {devicectlProblem} = await import('../../app/common/node/device/apps.js');
    const json = {
      error: {
        code: 12040,
        domain: 'com.apple.dt.CoreDeviceError',
        userInfo: {
          NSLocalizedDescription: {string: 'The developer disk image could not be mounted on this device.'},
          NSUnderlyingError: {
            error: {
              userInfo: {
                NSLocalizedDescription: {string: 'kAMDMobileImageMounterPersonalizedBundleMissingVariantError'},
              },
            },
          },
        },
      },
    };
    expect(devicectlProblem(json)).toEqual({reason: 'xcodeTooOld'});
    expect(devicectlProblem({result: {apps: []}})).toBeNull();
    expect(devicectlProblem({error: {userInfo: {NSLocalizedDescription: {string: 'Something else'}}}})).toEqual({
      reason: 'failed',
      message: 'Something else',
    });
  });
});
