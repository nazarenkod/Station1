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
   (doctor, Jira, AI) are only in the desktop app. Served by the plugin, the page gets the doctor of
   the Appium server's machine; Jira and AI stay in the desktop app, which keeps credentials in the
   system keychain.

## Command line and CI

`npm run build:cli` builds `dist-cli/vision-inspector.mjs` (also installed as `vision-inspector`):

```bash
vision-inspector doctor                       # servers, devices, environment
vision-inspector audit                        # the first session on http://127.0.0.1:4723
vision-inspector audit --session <id> --format junit --output a11y.xml
vision-inspector audit --source screen.xml --screenshot screen.png --density 420 --format html --output a11y.html
```

`--config` takes rules exported from the app, `--decisions` the decisions exported from it, so issues
already filed or ignored do not fail the build. `--fail-on error|warning|info|none` sets what fails it
(exit code 1).

## MCP

`vision-inspector mcp` serves the doctor and the audit to agents over stdio: tools `doctor`,
`audit_screen` and `list_rules`. For Kiro CLI, add to `~/.kiro/settings/mcp.json`:

```json
{"mcpServers": {"vision-inspector": {"command": "vision-inspector", "args": ["mcp"]}}}
```

Driving the app is left to the official `appium-mcp`; Vision Inspector looks at what it shows.

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
