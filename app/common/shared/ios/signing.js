/**
 * A bundle id for WebDriverAgent of one team. Bundle ids are unique across
 * all of Apple, so the stock one is often taken: this one is the team's own.
 */
export const wdaBundleIdFor = (teamId) => `com.station1.${teamId.toLowerCase()}.WebDriverAgentRunner`;

/**
 * The team to sign WebDriverAgent with: the one chosen in the settings, else
 * the only one this Mac has. Null when there is none, or several and none
 * was chosen.
 */
export function pickSigningTeam(teams, chosenTeamId) {
  if (chosenTeamId) {
    return teams.find((team) => team.teamId === chosenTeamId) ?? {teamId: chosenTeamId};
  }
  return teams.length === 1 ? teams[0] : null;
}

/**
 * What XCUITest needs to build, sign and start WebDriverAgent on a real
 * iPhone: the team, Xcode's automatic signing, a bundle id of the team's own,
 * the right to register the phone with the team, Xcode's log for when it
 * fails, and time for the first build.
 */
export function wdaSigningCapabilities({teamId, bundleId}) {
  return {
    'appium:xcodeOrgId': teamId,
    'appium:xcodeSigningId': 'Apple Development',
    'appium:updatedWDABundleId': bundleId || wdaBundleIdFor(teamId),
    'appium:allowProvisioningDeviceRegistration': true,
    'appium:showXcodeLog': true,
    'appium:wdaLaunchTimeout': 240000,
  };
}
