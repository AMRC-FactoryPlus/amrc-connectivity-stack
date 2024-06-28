import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import VueDevTools from 'vite-plugin-vue-devtools'
import importMetaEnv from '@import-meta-env/unplugin';
import process from 'process'
import inject from '@rollup/plugin-inject';
import path from 'node:path'

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
      env: ".env",
      example: ".env.example",
      // If you are using popular packagers such as Webpack and Vite,
      // @import-meta-env/unplugin will automatically switch the `transformMode` for you:
      // - for development mode, `transformMode` will be `"compile-time"`
      // - for production mode, `transformMode` will be `"runtime"`
      //
      // Otherwise, you need to set `transformMode` according to your needs:
      // transformMode: process.env.NODE_ENV === 'production' ? 'runtime' : 'compile-time',
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
      '@pages': fileURLToPath(new URL('./src/pages', import.meta.url)),
      '@store': fileURLToPath(new URL('./src/store', import.meta.url)),
      got: path.resolve(__dirname, './emptyModule.js'),
      ["got-fetch"]: path.resolve(__dirname, './emptyModule.js'),
      ["gssapi.js"]: path.resolve(__dirname, './emptyModule.js'),
    }
  }
})
