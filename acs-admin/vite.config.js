import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import VueDevTools from 'vite-plugin-vue-devtools'
import process from 'process'
import inject from '@rollup/plugin-inject';
import path from 'node:path'

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
    VueDevTools(),
    inject({
      Buffer: ['buffer', 'Buffer'],
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
      '@pages': fileURLToPath(new URL('./src/pages', import.meta.url)),
      '@store': fileURLToPath(new URL('./src/store', import.meta.url)),
      '@amrc-factoryplus/utilities': '@amrc-factoryplus/service-client',
      rxjs: fileURLToPath(new URL('./src/compat/rxjs.js', import.meta.url)),
      immutable: fileURLToPath(new URL('./src/compat/immutable.js', import.meta.url)),
      got: path.resolve(__dirname, './emptyModule.js'),
      ["got-fetch"]: path.resolve(__dirname, './emptyModule.js'),
      ["gssapi.js"]: path.resolve(__dirname, './emptyModule.js'),
    }
  }
})
