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
      files: ['dist/index.html'], // explicitly define the correct path
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
      'path': 'path-browserify',
    },
    preserveSymlinks: true,
  }
})
