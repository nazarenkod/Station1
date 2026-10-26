import {describe, expect, it, vi} from 'vitest';

// the session actions load i18n: an empty set of translations is enough here
vi.mock('../../app/common/renderer/polyfills.js', () => ({
  backend: {},
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  localesPath: '',
  i18NextBackend: {
    type: 'backend',
    init() {},
    read(_l, _n, cb) {
      cb(null, {});
    },
  },
  i18NextBackendOptions: {},
}));

const {sessionErrorHint} = await import('../../app/common/renderer/actions/SessionBuilder.js');

describe('session errors in plain words', function () {
  it('knows WebDriverAgent that did not build and an app that cannot start', function () {
    expect(sessionErrorHint('Unable to launch WebDriverAgent. Original error: xcodebuild failed with code 65.')).toBe(
      'sessionHintWda',
    );
    expect(sessionErrorHint("Unable to resolve the launchable activity of 'ua.pb.privat24'")).toBe(
      'sessionHintNoActivity',
    );
    expect(sessionErrorHint('Could not find a connected Android device')).toBeNull();
  });
});
