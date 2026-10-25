import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {defineConfig} from 'vite';

const {version} = JSON.parse(readFileSync(join(import.meta.dirname, 'package.json'), 'utf8'));

// The command line tool: one Node.js file with the a11y engine, the doctor and the MCP server
export default defineConfig({
  define: {__VERSION__: JSON.stringify(version)},
  build: {
    ssr: join(import.meta.dirname, 'app', 'cli', 'vision-inspector.js'),
    outDir: join(import.meta.dirname, 'dist-cli'),
    emptyOutDir: true,
    target: 'node20',
    rollupOptions: {
      output: {
        entryFileNames: 'vision-inspector.mjs',
        banner: '#!/usr/bin/env node',
      },
    },
  },
});
