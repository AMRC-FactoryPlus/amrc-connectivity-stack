/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import VueDevTools from 'vite-plugin-vue-devtools'
import importMetaEnv from '@import-meta-env/unplugin'
import process from 'process'
import inject from '@rollup/plugin-inject'
import path from 'node:path'
import monacoEditorEsmPlugin from 'vite-plugin-monaco-editor-esm'

// XXX I'm not sure why we're mixing __dirname and import.meta here?
const EMPTY = path.resolve(__dirname, './emptyModule.js');
const src = d => fileURLToPath(new URL(`./src/${d}`, import.meta.url));

/* Remove the inline script vite-plugin-monaco-editor-esm injects.
 *
 * The plugin has no option to skip it, and an inline script would force the
 * console's Content-Security-Policy to allow 'unsafe-inline', which disables
 * hashes and nonces along with it. src/main.js sets MonacoEnvironment
 * instead, from inside the bundle.
 *
 * Only the HTML injection goes. The plugin's writeBundle still emits the
 * worker files those paths point at, so it stays in the plugin list.
 *
 * Runs at enforce: 'post' so it sees the plugin's output. If the plugin ever
 * stops injecting, or renames the global, the build fails loudly rather than
 * silently leaving an inline script behind for the CSP to trip over.
 */
function stripMonacoInlineScript () {
  const MARKER = 'self["MonacoEnvironment"]';
  return {
    name: 'acs-strip-monaco-inline-script',
    enforce: 'post',
    transformIndexHtml (html) {
      const re = /<script>[^<]*self\["MonacoEnvironment"\][\s\S]*?<\/script>/;
      if (!re.test(html)) {
        throw new Error(
          `acs-strip-monaco-inline-script: no script containing ${MARKER} `
          + `found in index.html. The Monaco plugin's injection has changed; `
          + `check whether src/main.js still needs to define MonacoEnvironment, `
          + `and whether the worker paths there are still correct.`);
      }
      return html.replace(re, '');
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    process: process,
    global: 'window',
  },
  build: {
    target: 'esnext',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      treeshake: 'safest'
    },
    commonjsOptions: {
      strictRequires: true,
      transformMixedEsModules: true,
    },
  },
  optimizeDeps: {
    include: ['buffer'],
    esbuildOptions: {
      target: 'esnext',
    }
  },
  plugins: [
    importMetaEnv.vite({
      env: '.env',
      example: '.env.example',
      files: ['dist/env.js'], // the placeholder lives here, not in index.html
    }),
    vue(),
    VueDevTools(),
    inject({
      Buffer: ['buffer', 'Buffer'],
    }),
    monacoEditorEsmPlugin({
      languageWorkers: ['editorWorkerService', 'json'],
      customWorkers: [
        {
          label: "yaml",
          entry: "monaco-yaml",
          worker: {
            id: "monaco-yaml/yamlWorker",
            entry: "monaco-yaml/yaml.worker"
          }
        }
      ],
      globalAPI: true,
    }),
    stripMonacoInlineScript(),
  ],
  resolve: {
    alias: {
      '@': src(''),
      '@components': src('components'),
      '@utils': src('utils'),
      '@composables': src('composables'),
      '@pages': src('pages'),
      '@store': src('store'),
      'got': EMPTY,
      'got-fetch': EMPTY,
      'gssapi.js': EMPTY,
      '@amrc-factoryplus/gssapi': EMPTY,
      'path': 'path-browserify',
      'buffer': 'buffer/',
    },
    preserveSymlinks: true,
  }
})
