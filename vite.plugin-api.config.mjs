import {join} from 'node:path';

import {defineConfig} from 'vite';

// The doctor's HTTP API for the Appium plugin: Node.js code the plugin loads on the server
export default defineConfig({
  build: {
    ssr: join(import.meta.dirname, 'app', 'common', 'node', 'plugin-api.js'),
    outDir: join(import.meta.dirname, 'plugins', 'dist-node'),
    emptyOutDir: true,
    target: 'node20',
    rollupOptions: {output: {entryFileNames: 'api.mjs'}},
  },
});
