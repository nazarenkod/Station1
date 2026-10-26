import {readFileSync} from 'node:fs';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {parseSigningTeams} from '../../app/common/node/device/signing.js';
import {pickSigningTeam, wdaBundleIdFor, wdaSigningCapabilities} from '../../app/common/shared/ios/signing.js';

const pem = readFileSync(path.join(import.meta.dirname, '../fixtures/signing/apple-development.pem'), 'utf8');

describe('signing teams of a Mac', function () {
  it('reads each team once from the development certificates', function () {
    expect(parseSigningTeams(pem)).toEqual([
      {teamId: 'TEAM123456', teamName: 'Test Bank', certificate: 'Apple Development: Test User (AB12CD34EF)'},
      {teamId: 'PERS987654', teamName: 'Test User', certificate: 'Apple Development: Test User (AB12CD34EF)'},
    ]);
  });

  it('leaves out expired certificates and what is not a certificate', function () {
    expect(parseSigningTeams(pem, new Date('2040-01-01'))).toEqual([]);
    expect(parseSigningTeams('')).toEqual([]);
  });
});

describe('the team WebDriverAgent is signed with', function () {
  const teams = [{teamId: 'TEAM123456'}, {teamId: 'PERS987654'}];

  it('is the chosen one, else the only one, else none', function () {
    expect(pickSigningTeam(teams, 'PERS987654')).toEqual({teamId: 'PERS987654'});
    expect(pickSigningTeam([teams[0]], null)).toEqual({teamId: 'TEAM123456'});
    expect(pickSigningTeam(teams, null)).toBeNull();
    expect(pickSigningTeam([], null)).toBeNull();
  });

  it('signs with the team, a bundle id of its own and room for the first build', function () {
    expect(wdaSigningCapabilities({teamId: 'TEAM123456'})).toEqual({
      'appium:xcodeOrgId': 'TEAM123456',
      'appium:xcodeSigningId': 'Apple Development',
      'appium:updatedWDABundleId': wdaBundleIdFor('TEAM123456'),
      'appium:allowProvisioningDeviceRegistration': true,
      'appium:showXcodeLog': true,
      'appium:wdaLaunchTimeout': 240000,
    });
    expect(wdaSigningCapabilities({teamId: 'T', bundleId: 'ua.bank.wda'})['appium:updatedWDABundleId']).toBe(
      'ua.bank.wda',
    );
  });
});
