/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import VueDevTools from 'vite-plugin-vue-devtools'
import importMetaEnv from '@import-meta-env/unplugin'
import process from 'process'
import inject from '@rollup/plugin-inject'
import path from 'node:path'

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
    rollupOptions: {
      treeshake: 'safest'
    }
  },
  optimizeDeps: {
    include: ['buffer'],
    esbuildOptions: {
      target: 'esnext',
    }
  },
  plugins: [
    vue(),
    VueDevTools(),
    inject({
      Buffer: ['buffer', 'Buffer'],
    }),
    importMetaEnv.vite({
      env: '.env',
      example: '.env.example',
    }),
  ],
  resolve: {
    alias: {
      '@': src(''),
      '@components': src('components'),
      '@composables': src('composables'),
      '@pages': src('pages'),
      '@store': src('store'),
      'got': EMPTY,
      'got-fetch': EMPTY,
      'gssapi.js': EMPTY,
      '@amrc-factoryplus/sparkplug-app': EMPTY,
      'rxjs': EMPTY,
    }
  }
})
