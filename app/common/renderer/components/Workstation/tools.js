import {
  IconActivity,
  IconArrowsExchange,
  IconDeviceMobileCog,
  IconFocus2,
  IconLayoutDashboard,
  IconPackage,
  IconTerminal2,
} from '@tabler/icons-react';

/**
 * The workstation's tools, in tab order. A tool owns one or more routes;
 * `ready: false` marks a tool whose tab shows what it will do.
 */
export const TOOLS = [
  {key: 'home', path: '/', paths: ['/'], icon: IconLayoutDashboard, ready: true},
  // the accessibility check is a tab of the Inspector; /a11y opens it there
  {key: 'inspector', path: '/session', paths: ['/session', '/inspector', '/a11y'], icon: IconFocus2, ready: true},
  {key: 'proxy', path: '/proxy', paths: ['/proxy'], icon: IconArrowsExchange, ready: true},
  {key: 'logs', path: '/logs', paths: ['/logs'], icon: IconTerminal2, ready: true},
  {key: 'perf', path: '/perf', paths: ['/perf'], icon: IconActivity, ready: true},
  {key: 'builds', path: '/builds', paths: ['/builds'], icon: IconPackage, ready: true},
  // the doctor of this Mac and the devices: the station itself, apart from the work on a task
  {key: 'station', path: '/station', paths: ['/station'], icon: IconDeviceMobileCog, ready: true},
];

export const toolOf = (pathname) => TOOLS.find((tool) => tool.paths.includes(pathname)) ?? null;
