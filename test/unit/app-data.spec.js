import {describe, expect, it} from 'vitest';

import {fileKind, isSqlite, prefsFormat, sidecarOwner} from '../../app/common/shared/app-data/classify.js';
import {parseDataStore, writeDataStore} from '../../app/common/shared/app-data/datastore.js';
import {parsePlistPrefs, writePlistPrefs} from '../../app/common/shared/app-data/plist.js';
import {
  flutterKey,
  isEncryptedPrefs,
  parseSharedPrefs,
  writeSharedPrefs,
} from '../../app/common/shared/app-data/prefs-android.js';
import {APP_DATA_PINS} from '../../app/common/shared/setting-defs.js';
import {cleanPins, GROUPS, PROFILE_GROUPS} from '../../app/common/shared/settings/groups.js';

const SHARED_PREFS = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="auth_token">eyJ&lt;x&gt;</string>
    <boolean name="onboarding_done" value="true" />
    <int name="launches" value="7" />
    <long name="last_sync" value="1761600000123456789" />
    <float name="scale" value="1.5" />
    <set name="seen_tips">
        <string>a</string>
        <string>b</string>
    </set>
    <string name="empty" />
    <string name="flutter.locale">uk</string>
</map>`;

describe('SharedPreferences', function () {
  it('reads every type with its value, a long as text so no digit is lost', function () {
    expect(parseSharedPrefs(SHARED_PREFS)).toEqual([
      {key: 'auth_token', type: 'string', value: 'eyJ<x>'},
      {key: 'onboarding_done', type: 'boolean', value: true},
      {key: 'launches', type: 'int', value: 7},
      {key: 'last_sync', type: 'long', value: '1761600000123456789'},
      {key: 'scale', type: 'float', value: 1.5},
      {key: 'seen_tips', type: 'set', value: ['a', 'b']},
      {key: 'empty', type: 'string', value: ''},
      {key: 'flutter.locale', type: 'string', value: 'uk'},
    ]);
  });

  it('writes back what it read', function () {
    const entries = parseSharedPrefs(SHARED_PREFS);
    expect(parseSharedPrefs(writeSharedPrefs(entries))).toEqual(entries);
  });

  it('refuses a file that is not SharedPreferences', function () {
    expect(() => parseSharedPrefs('<plist><dict/></plist>')).toThrow('Not a SharedPreferences file');
  });

  it('marks EncryptedSharedPreferences as encrypted', function () {
    expect(
      isEncryptedPrefs([{key: '__androidx_security_crypto_encrypted_prefs_key_keyset__', type: 'string', value: 'x'}]),
    ).toBe(true);
    expect(isEncryptedPrefs(parseSharedPrefs(SHARED_PREFS))).toBe(false);
  });

  it('splits the flutter. prefix off for showing it grey', function () {
    expect(flutterKey('flutter.locale')).toEqual({prefix: 'flutter.', name: 'locale'});
    expect(flutterKey('locale')).toEqual({prefix: '', name: 'locale'});
  });
});

describe('DataStore Preferences', function () {
  const entries = [
    {key: 'dark', type: 'boolean', value: true},
    {key: 'count', type: 'int', value: -3},
    {key: 'big', type: 'long', value: '9007199254740993'},
    {key: 'ratio', type: 'float', value: 0.25},
    {key: 'pi', type: 'double', value: 3.141592653589793},
    {key: 'name', type: 'string', value: 'Дмитро'},
    {key: 'tags', type: 'set', value: ['x', 'y']},
    {key: 'blob', type: 'data', value: 'AAEC'},
  ];

  it('writes and reads every type of value', function () {
    expect(parseDataStore(writeDataStore(entries))).toEqual(entries);
  });

  it('reads a file DataStore wrote', function () {
    // PreferenceMap {"a": string "b"}, as DataStore writes it
    const bytes = Uint8Array.from([0x0a, 0x08, 0x0a, 0x01, 0x61, 0x12, 0x03, 0x2a, 0x01, 0x62]);
    expect(parseDataStore(bytes)).toEqual([{key: 'a', type: 'string', value: 'b'}]);
  });

  it('refuses a broken file', function () {
    expect(() => parseDataStore(Uint8Array.from([0x0a, 0x10, 0x0a]))).toThrow('Broken protobuf');
  });
});

describe('UserDefaults', function () {
  const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>hasSeenOnboarding</key>
	<true/>
	<key>launches</key>
	<integer>12</integer>
	<key>huge</key>
	<integer>9223372036854775807</integer>
	<key>ratio</key>
	<real>0.5</real>
	<key>lastOpen</key>
	<date>2026-10-27T10:00:00Z</date>
	<key>blob</key>
	<data>
	AAEC
	</data>
	<key>user</key>
	<dict>
		<key>id</key>
		<integer>42</integer>
		<key>roles</key>
		<array><string>qa</string></array>
	</dict>
	<key>flutter.locale</key>
	<string>uk &amp; en</string>
</dict>
</plist>`;

  it('keeps the types: a date stays a date, data stays data, a big integer stays whole', function () {
    expect(parsePlistPrefs(XML)).toEqual([
      {key: 'hasSeenOnboarding', type: 'boolean', value: true},
      {key: 'launches', type: 'int', value: 12},
      {key: 'huge', type: 'long', value: '9223372036854775807'},
      {key: 'ratio', type: 'double', value: 0.5},
      {key: 'lastOpen', type: 'date', value: '2026-10-27T10:00:00Z'},
      {key: 'blob', type: 'data', value: 'AAEC'},
      {key: 'user', type: 'dict', value: {id: 42, roles: ['qa']}},
      {key: 'flutter.locale', type: 'string', value: 'uk & en'},
    ]);
  });

  it('writes back what it read', function () {
    const entries = parsePlistPrefs(XML);
    expect(parsePlistPrefs(writePlistPrefs(entries))).toEqual(entries);
    expect(parsePlistPrefs(writePlistPrefs([]))).toEqual([]);
  });
});

describe('what a file is', function () {
  it('finds the preferences of each platform, the groups of iOS included', function () {
    expect(prefsFormat('shared_prefs/app.xml', 'android')).toBe('shared-prefs');
    expect(prefsFormat('files/datastore/settings.preferences_pb', 'android')).toBe('datastore');
    expect(prefsFormat('Library/Preferences/ua.pb.app.plist', 'ios')).toBe('plist');
    expect(prefsFormat('@group.ua.pb/Library/Preferences/group.ua.pb.plist', 'ios')).toBe('plist');
    expect(prefsFormat('Library/Preferences/sub/x.plist', 'ios')).toBe(null);
    expect(prefsFormat('files/app.xml', 'android')).toBe(null);
  });

  it('tells a database by its first bytes, and by name before it is pulled', function () {
    const head = new TextEncoder().encode('SQLite format 3\u0000rest');
    expect(isSqlite(head)).toBe(true);
    expect(fileKind('files/cache.bin', {platform: 'android', head})).toBe('sqlite');
    expect(fileKind('databases/app_database', {platform: 'android'})).toBe('sqlite');
    expect(fileKind('Library/Application Support/Model.sqlite', {platform: 'ios'})).toBe('sqlite');
    expect(fileKind('databases/app_database-wal', {platform: 'android'})).toBe('sqlite-aux');
    expect(sidecarOwner('databases/app_database-wal')).toBe('databases/app_database');
  });

  it('gives each other file a kind for its preview', function () {
    expect(fileKind('files/config.json', {})).toBe('json');
    expect(fileKind('Documents/photo.PNG', {})).toBe('image');
    expect(fileKind('Library/x.plist', {platform: 'ios'})).toBe('plist');
    expect(fileKind('files/blob', {head: new TextEncoder().encode('bplist00xxxx')})).toBe('plist');
    expect(fileKind('files/notes', {head: new TextEncoder().encode('just some text\n')})).toBe('text');
    expect(fileKind('files/raw', {head: Uint8Array.from([0, 1, 2, 3, 255, 254])})).toBe('binary');
    expect(fileKind('shared_prefs/a.xml', {platform: 'android'})).toBe('prefs');
  });
});

describe('pinned keys', function () {
  it('go with the profile, so the team pins the onboarding flag once', function () {
    expect(PROFILE_GROUPS).toContain('appData');
    const pins = {'ua.app': [{file: 'shared_prefs/app.xml', key: 'onboarding_done'}]};
    expect(GROUPS.appData.read({[APP_DATA_PINS]: pins})).toEqual(pins);
    expect(GROUPS.appData.write(pins)).toEqual({[APP_DATA_PINS]: pins});
    expect(GROUPS.appData.valid(pins)).toBe(true);
    expect(GROUPS.appData.valid({'ua.app': 'x'})).toBe(false);
  });

  it('keep only a file and a key, never a value', function () {
    expect(
      cleanPins({
        'ua.app': [{file: 'a.xml', key: 'k', value: 'secret'}, {file: 'files/x.json'}, {key: 'no file'}],
        'ua.empty': [],
        broken: 'x',
      }),
    ).toEqual({'ua.app': [{file: 'a.xml', key: 'k'}, {file: 'files/x.json'}]});
  });
});
