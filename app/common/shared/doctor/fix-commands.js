// How to fix what the doctor finds, as a command for a terminal of this
// platform. The station shows it on the «Station» tab; the agent may run it,
// with the person's yes, through env_run_fix.

export const COMMANDS = {
  // the default of nvm, so every new terminal gets it, not only this one
  node: {mac: 'nvm install 22 && nvm alias default 22', win: 'nvm install 22 && nvm use 22'},
  appium: {mac: 'npm i -g appium@latest', win: 'npm i -g appium@latest'},
  appiumMissing: {mac: 'npm i -g appium', win: 'npm i -g appium'},
  driver: ({driver}) => `appium driver install ${driver}`,
  androidSdk: {mac: 'brew install --cask android-studio', win: 'winget install Google.AndroidStudio'},
  androidSdkMissing: {
    mac: `echo 'export ANDROID_HOME="$HOME/Library/Android/sdk"' >> ~/.zshrc`,
    win: 'setx ANDROID_HOME "%LOCALAPPDATA%\\Android\\Sdk"',
  },
  androidHome: ({path}, platform) =>
    platform === 'win' ? `setx ANDROID_HOME "${path}"` : `echo 'export ANDROID_HOME="${path}"' >> ~/.zshrc`,
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

// fixes that ask something (a password, a sign-in in the browser) or only
// show something: the engineer runs them in a terminal, the agent does not
export const TERMINAL_ONLY = new Set(['xcode', 'kiroLogin', 'shellEnv']);

/** The command that fixes a check, for a platform ('mac' or 'win'), or null. */
export const commandFor = (key, params = {}, platform = 'mac') => {
  const command = COMMANDS[key];
  if (!command) {
    return null;
  }
  if (typeof command === 'function') {
    return command(params, platform);
  }
  return (platform === 'win' ? command.win : command.mac) ?? null;
};

/** The key of a check's fix: a found Java without JAVA_HOME is fixed differently from a missing one. */
export const fixKey = (check) => (check.id === 'java' && check.status === 'warn' ? 'javaHome' : check.id);
