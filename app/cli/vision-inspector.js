import {readFile, writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';

import {auditScreen, captureSession, failsAt} from '../common/node/a11y/audit.js';
import {toHtml, toJson, toJunit, toText, t} from '../common/node/a11y/formats.js';
import {inspectBuild} from '../common/node/builds/inspect.js';
import {listDevices} from '../common/node/doctor/devices.js';
import {checkEnvironment} from '../common/node/doctor/environment.js';
import {scanServers} from '../common/node/doctor/servers.js';
import {mergeConfig} from '../common/renderer/lib/a11y/config';
import {A11Y_RULES} from '../common/renderer/lib/a11y/types';
import {failsAt as findingsFailAt} from '../common/shared/findings/findings.js';
import {checkManifest} from '../common/shared/findings/manifest-rules.js';
import {PRODUCT_NAME} from '../common/shared/product.js';
import {startMcpServer} from './mcp.js';

// set at build time by vite.cli.config.mjs
// oxlint-disable-next-line no-undef
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';

const HELP = `${PRODUCT_NAME} ${VERSION}

Usage:
  vision-inspector doctor [--json]
      Appium servers, devices and what the machine lacks.

  vision-inspector audit [options]
      Checks a screen against the accessibility rules.
      --server <url>         Appium server of a running session (default http://127.0.0.1:4723)
      --session <id>         the session to check (default: the server's first one)
      --source <file.xml>    a saved page source instead of a session
      --screenshot <file>    its screenshot (PNG), for the contrast rules
      --density <dpi>        Android screen density, when checking files
      --app <id>             app id the decisions are kept under (files only)
      --config <file.json>   rules exported from the app
      --decisions <file>     decisions exported from the app: filed and ignored issues do not fail
      --format <f>           text (default), json, html or junit
      --output <file>        write the report there instead of stdout
      --fail-on <level>      error (default), warning, info or none: open issues that fail the run

  vision-inspector build <file> [options]
      Reads an APK, IPA or .app and checks its manifest or Info.plist.
      --config <file.json>   rule settings: {"manifest": {"android-target-sdk": {"minTargetSdk": 34}}}
      --format <f>           text (default) or json
      --output <file>        write the report there instead of stdout
      --fail-on <level>      high (default), medium, low, info or none

  vision-inspector mcp
      Runs as an MCP server on stdio (for Kiro CLI and other agents). With the
      station running and «External agents» on, it also gives the packages of
      screen objects saved there (STATION_DATA_DIR: the station's data folder).
`;

const readJson = async (file) => (file ? JSON.parse(await readFile(file, 'utf8')) : null);

const CHECK_TEXT = {ok: '✔', warn: '▲', error: '✖'};

async function doctor({json}) {
  const [servers, devices, environment] = await Promise.all([scanServers(), listDevices(), checkEnvironment()]);
  if (json) {
    return {output: JSON.stringify({servers, devices: devices.devices, environment}, null, 2), code: 0};
  }
  const lines = ['Appium servers'];
  lines.push(
    ...(servers.length
      ? servers.map((s) => `  ${s.url}  ${s.version ?? '?'}  ${s.sessions ? `${s.sessions.length} session(s)` : ''}`)
      : ['  none running']),
  );
  lines.push('', 'Devices');
  lines.push(
    ...(devices.devices.length
      ? devices.devices.map(
          (d) => `  ${d.state === 'running' ? '●' : '○'} ${d.name} ${d.platformVersion}  ${d.kind}  ${d.id}`,
        )
      : ['  none found']),
  );
  lines.push('', 'Environment');
  lines.push(
    ...environment.checks.map(
      (check) => `  ${CHECK_TEXT[check.status]} ${t(`doctorCheck_${check.id}_${check.status}`, check.params)}`,
    ),
  );
  const failed = environment.checks.some((check) => check.status === 'error');
  return {output: lines.join('\n'), code: failed ? 1 : 0};
}

async function audit(options) {
  const config = await readJson(options.config);
  const decisions = await readJson(options.decisions);
  let input;
  if (options.source) {
    input = {
      sourceXml: await readFile(options.source, 'utf8'),
      png: options.screenshot ? await readFile(options.screenshot) : null,
      densityDpi: options.density ? Number(options.density) : null,
      appId: options.app ?? 'app',
    };
  } else {
    input = await captureSession(options.server ?? 'http://127.0.0.1:4723', options.session);
  }
  const result = auditScreen({...input, config, decisions});
  const format = options.format ?? 'text';
  const output =
    format === 'json'
      ? toJson(result)
      : format === 'html'
        ? toHtml(result, input.png)
        : format === 'junit'
          ? toJunit(
              result,
              A11Y_RULES.filter((rule) => mergeConfig(config).rules[rule].enabled),
            )
          : toText(result);
  return {output, code: failsAt(result.reviewed, options['fail-on'] ?? 'error') ? 1 : 0};
}

const SEVERITY_TEXT = {high: 'HIGH  ', medium: 'MEDIUM', low: 'LOW   ', info: 'INFO  '};

async function checkBuildFile(file, options) {
  if (!file) {
    throw new Error('Name the build file: vision-inspector build app.apk');
  }
  const build = await inspectBuild(file);
  const config = await readJson(options.config);
  const findings = checkManifest(build, config?.manifest ?? {});
  const code = findingsFailAt(findings, options['fail-on'] ?? 'high') ? 1 : 0;
  if (options.format === 'json') {
    const {manifest, ...summary} = build;
    return {output: JSON.stringify({build: summary, manifest, findings}, null, 2), code};
  }
  const version = [build.version, build.build && `(${build.build})`].filter(Boolean).join(' ');
  const lines = [
    `${build.appId} ${version}`,
    `  ${build.format.toUpperCase()} · ${build.signing} · ${build.minOs || 'min OS unknown'}`,
    '',
  ];
  if (!findings.length) {
    lines.push('No findings.');
  }
  // one heading per rule, like the app shows them; a rule may count for itself
  const byRule = new Map();
  for (const finding of findings) {
    byRule.set(finding.rule, [...(byRule.get(finding.rule) ?? []), finding]);
  }
  for (const [rule, group] of byRule) {
    const [first] = group;
    lines.push(
      `${SEVERITY_TEXT[first.severity]}  ${t(`finding_${rule}_title`, {count: group.length, ...first.params})}`,
    );
    lines.push(...group.flatMap((finding) => finding.evidence.map((line) => `          ${line}`)));
  }
  return {output: lines.join('\n'), code};
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const {values, positionals} = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      json: {type: 'boolean'},
      server: {type: 'string'},
      session: {type: 'string'},
      source: {type: 'string'},
      screenshot: {type: 'string'},
      density: {type: 'string'},
      app: {type: 'string'},
      config: {type: 'string'},
      decisions: {type: 'string'},
      format: {type: 'string'},
      output: {type: 'string'},
      'fail-on': {type: 'string'},
    },
  });
  if (command === 'mcp') {
    await startMcpServer();
    return;
  }
  if (command === '--version' || command === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (!['doctor', 'audit', 'a11y', 'build'].includes(command)) {
    process.stdout.write(HELP);
    process.exitCode = command && !['help', '--help', '-h'].includes(command) ? 2 : 0;
    return;
  }
  try {
    const {output, code} =
      command === 'doctor'
        ? await doctor(values)
        : command === 'build'
          ? await checkBuildFile(positionals[0], values)
          : await audit(values);
    if (values.output) {
      await writeFile(values.output, output);
    } else {
      process.stdout.write(`${output}\n`);
    }
    process.exitCode = code;
  } catch (error) {
    process.stderr.write(`vision-inspector: ${error.message}\n`);
    process.exitCode = 2;
  }
}

main();
