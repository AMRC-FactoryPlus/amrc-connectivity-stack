/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* Vitest takes this in preference to vite.config.js. The app config
 * pulls in the import-meta-env plugin, which needs a populated .env that
 * the unit tests have no use for. The schema library under test is plain
 * ES modules with no Vue or browser dependency. */

import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@store': fileURLToPath(new URL('./src/store', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
      '@pages': fileURLToPath(new URL('./src/pages', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
})
