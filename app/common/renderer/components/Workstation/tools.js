import {IconArrowsExchange, IconFocus2, IconLayoutDashboard, IconPackage, IconTerminal2} from '@tabler/icons-react';

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
  {key: 'builds', path: '/builds', paths: ['/builds'], icon: IconPackage, ready: true},
];

export const toolOf = (pathname) => TOOLS.find((tool) => tool.paths.includes(pathname)) ?? null;
