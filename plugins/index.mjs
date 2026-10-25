import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {BasePlugin} from '@appium/base-plugin';
const PLUGIN_ROOT_PATH = '/inspector';
const INDEX_HTML = 'index.html';
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'dist-browser');

/**
 * Vision Inspector plugin class
 * @extends {BasePlugin}
 */
export class VisionInspectorPlugin extends BasePlugin {
  /**
   * Creates an instance of VisionInspectorPlugin
   * @param {string} name - The name of the plugin
   * @param {Record<string, unknown>} cliArgs - Command line arguments
   */
  constructor(name, cliArgs) {
    super(name, cliArgs);
  }

  /**
   * Handles inspector page requests
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   * @returns {Promise<void>}
   */
  static async openInspector(req, res) {
    const reqPath = req.path === PLUGIN_ROOT_PATH ? INDEX_HTML : req.path.substring(PLUGIN_ROOT_PATH.length);
    res.sendFile(reqPath, {root: ROOT_DIR});
  }

  /**
   * Updates the Express server configuration
   * @param {import('express').Application} expressApp - Express application instance
   * @param {import('http').Server} _httpServer - HTTP server instance
   * @param {Record<string, unknown>} cliArgs - Appium server arguments
   * @returns {Promise<void>}
   */
  static async updateServer(expressApp, _httpServer, cliArgs) {
    // the doctor's API first, so the catch-all below does not serve files for it
    const {registerRoutes} = await import('./dist-node/api.mjs');
    registerRoutes(expressApp, {port: cliArgs?.port});
    // Handle both /inspector and /inspector/* paths
    expressApp.all(['/inspector', '/inspector/*all'], VisionInspectorPlugin.openInspector);
  }
}
