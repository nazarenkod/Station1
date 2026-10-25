# Vision Inspector

A GUI inspector for Android and iOS apps, powered by Appium, with what everyday mobile QA work needs on top:

- **Doctor**: finds running Appium servers, connected devices, emulators and simulators, checks the
  environment, and starts its own Appium server when none is running. Picking a device fills in the
  session capabilities.
- **Accessibility audit** of the current screen: missing and meaningless labels, touch target size,
  text and non-text contrast, duplicate labels, reading order and more. Rules and thresholds are
  configurable, and stress modes re-check the screen in dark theme, with large fonts and rotated.
- **Jira Cloud filing**: an accessibility issue becomes a bug under a task, with the team's template,
  fields copied from the task and the screenshot with the element outlined. Issues already filed for
  a screen are recognised by its title and never filed twice.
- **AI checks** (Gemini or Kiro CLI, opt-in): what rules cannot see, such as a label that does not match
  its icon or information shown only by colour.

Everything the original inspector does is still here: screenshot and page source, element search,
locators, commands, gestures, the recorder and the cloud provider integrations.

## Formats

1. Desktop application for macOS, Windows and Linux (`npm run pack:electron`)
2. Appium server plugin, see the [plugin README](./plugins/README.md)
3. Web application (`npm run build:browser`). Features that need local processes or credentials
   (doctor, Jira, AI) are only available in the desktop app and the plugin.

## Development

```bash
npm ci
npm run dev:electron   # desktop app with hot reload
npm run dev:browser    # web app
npm test               # lint, unit and integration tests
```

## Origin and license

Vision Inspector is based on [Appium Inspector](https://github.com/appium/appium-inspector) by the
Appium developers and is distributed under the same [Apache-2.0](./LICENSE) license.
