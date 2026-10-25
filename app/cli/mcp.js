import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';

import {auditScreen, captureSession} from '../common/node/a11y/audit.js';
import {t, toJson} from '../common/node/a11y/formats.js';
import {listDevices} from '../common/node/doctor/devices.js';
import {checkEnvironment} from '../common/node/doctor/environment.js';
import {scanServers} from '../common/node/doctor/servers.js';
import {DEFAULT_A11Y_CONFIG} from '../common/renderer/lib/a11y/config';
import {A11Y_RULES} from '../common/renderer/lib/a11y/types';

const text = (value) => ({
  content: [{type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2)}],
});

/**
 * Vision Inspector's checks for agents (Kiro CLI, Claude Code…). Driving the
 * app is left to the official appium-mcp; these tools look at what it shows.
 */
export async function startMcpServer() {
  const server = new McpServer({name: 'vision-inspector', version: '1.0.0'});

  server.registerTool(
    'doctor',
    {
      title: 'Mobile test environment',
      description:
        'Appium servers on this machine with their sessions, Android and iOS devices, and environment checks.',
      inputSchema: {},
    },
    async () => {
      const [servers, devices, environment] = await Promise.all([scanServers(), listDevices(), checkEnvironment()]);
      return text({
        servers,
        devices: devices.devices,
        environment: environment.checks.map((check) => ({
          status: check.status,
          text: t(`doctorCheck_${check.id}_${check.status}`, check.params),
        })),
      });
    },
  );

  server.registerTool(
    'audit_screen',
    {
      title: 'Accessibility audit of the current screen',
      description:
        'Checks the screen an Appium session shows against Vision Inspector accessibility rules: labels, touch targets, contrast, reading order and more. Returns the score and the issues with fixes.',
      inputSchema: {
        server: z.string().optional().describe('Appium server URL, default http://127.0.0.1:4723'),
        session: z.string().optional().describe("Session id; the server's first session when omitted"),
        rules: z.array(z.enum(A11Y_RULES)).optional().describe('Only these rules; all enabled ones when omitted'),
      },
    },
    async ({server: url, session, rules}) => {
      const capture = await captureSession(url ?? 'http://127.0.0.1:4723', session);
      const config = structuredClone(DEFAULT_A11Y_CONFIG);
      if (rules?.length) {
        for (const rule of A11Y_RULES) {
          config.rules[rule].enabled = rules.includes(rule);
        }
      }
      const result = auditScreen({...capture, config});
      return text(toJson(result));
    },
  );

  server.registerTool(
    'list_rules',
    {
      title: 'Accessibility rules',
      description: 'The rules audit_screen can run, with their default severity and what each checks.',
      inputSchema: {},
    },
    async () =>
      text(
        A11Y_RULES.map((rule) => ({
          rule,
          severity: DEFAULT_A11Y_CONFIG.rules[rule].severity,
          title: t(`a11yRule_${rule}`),
          fix: t(`a11yFix_${rule}`),
        })),
      ),
  );

  await server.connect(new StdioServerTransport());
}
