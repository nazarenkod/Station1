// How to fix what the doctor finds: a sentence (doctorFix_<key>), the command
// to paste into a terminal for this platform, and an action the app can take
// itself when there is one.

const isWindows = () => typeof navigator !== 'undefined' && /^win/i.test(navigator.platform ?? '');

const COMMANDS = {
  node: {mac: 'nvm install 22 && nvm use 22', win: 'nvm install 22 && nvm use 22'},
  appium: {mac: 'npm i -g appium@latest', win: 'npm i -g appium@latest'},
  appiumMissing: {mac: 'npm i -g appium', win: 'npm i -g appium'},
  driver: ({driver}) => `appium driver install ${driver}`,
  androidSdk: {mac: 'brew install --cask android-studio', win: 'winget install Google.AndroidStudio'},
  androidSdkMissing: {
    mac: `echo 'export ANDROID_HOME="$HOME/Library/Android/sdk"' >> ~/.zshrc`,
    win: 'setx ANDROID_HOME "%LOCALAPPDATA%\\Android\\Sdk"',
  },
  androidHome: ({path}) =>
    isWindows() ? `setx ANDROID_HOME "${path}"` : `echo 'export ANDROID_HOME="${path}"' >> ~/.zshrc`,
  adb: {mac: 'sdkmanager "platform-tools"', win: 'sdkmanager "platform-tools"'},
  java: {mac: 'brew install --cask temurin@17', win: 'winget install EclipseAdoptium.Temurin.17.JDK'},
  javaHome: {mac: `echo 'export JAVA_HOME="$(/usr/libexec/java_home)"' >> ~/.zshrc`},
  xcode: {mac: 'sudo xcode-select -s /Applications/Xcode.app/Contents/Developer'},
  kiroMissing: {mac: 'curl -fsSL https://cli.kiro.dev/install | bash'},
  kiroV3: {mac: 'kiro-cli update'},
  kiroLogin: {mac: 'kiro-cli login'},
  // shows how long the profile takes and where it stops to ask something
  shellEnv: ({shell}) => `time ${shell} -ilc exit`,
};

const commandFor = (key, params = {}) => {
  const command = COMMANDS[key];
  if (!command) {
    return null;
  }
  if (typeof command === 'function') {
    return command(params);
  }
  return (isWindows() ? command.win : command.mac) ?? null;
};

/**
 * The fix for one check of the doctor's environment report, or null when it passed.
 */
export function fixForCheck(check) {
  if (check.status === 'ok') {
    return null;
  }
  // java is found but JAVA_HOME is not set: a different fix from a missing JDK
  const key = check.id === 'java' && check.status === 'warn' ? 'javaHome' : check.id;
  const fix = {key, command: commandFor(key, check.params)};
  if (check.fix?.action === 'installDriver') {
    fix.action = {kind: 'installDriver', driver: check.fix.driver};
  } else if (check.id === 'appiumMissing') {
    fix.action = {kind: 'installAppium'};
  }
  return fix;
}
