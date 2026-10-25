# vision-inspector-plugin

An Appium server plugin that serves [Vision Inspector](../README.md) from the server itself, at the
server's `/inspector` endpoint.

## Installation

Build the web app into the plugin and install the plugin from this folder:

```bash
npm run build:plugin
appium plugin install --source=local ./plugins
appium --use-plugins=vision-inspector
```

Then open `http://<appium-host>:<port>/inspector`. The Doctor tab there shows the servers, devices
and environment of the machine the Appium server runs on, and the accessibility stress modes switch
its devices. Jira and AI checks are in the desktop app only.

## License

[Apache-2.0](../LICENSE). Based on the Appium Inspector plugin by the Appium developers.
