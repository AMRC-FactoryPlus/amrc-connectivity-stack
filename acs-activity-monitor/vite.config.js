import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import * as path from 'node:path'
import process from 'process';
import inject from '@rollup/plugin-inject';

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    'process': process,
    global: 'window',
  },
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    include: ['buffer'],
    esbuildOptions: {
      target: 'esnext',
    }
  },
  plugins: [
    vue(),
    inject({
      Buffer: ['buffer', 'Buffer'],
    }),
  ],
  resolve: {
    alias: {
      buffer: 'buffer',
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      got: path.resolve(__dirname, './emptyModule.js'),
      ["got-fetch"]: path.resolve(__dirname, './emptyModule.js'),
      ["gssapi.js"]: path.resolve(__dirname, './emptyModule.js'),
      rxjs: path.resolve(__dirname, './emptyModule.js'),
      ["@amrc-factoryplus/sparkplug-app"]: path.resolve(__dirname, './emptyModule.js'),
    },
  },
})
