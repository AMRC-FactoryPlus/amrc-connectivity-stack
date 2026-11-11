/*
 * ACS Admin
 * Runs the vendored i3X Explorer's own tests
 * Copyright 2026 University of Sheffield
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/* As upstream's vitest.config.ts: most tests run in node, and the
 * component tests opt in to jsdom with a docblock. */
export default defineConfig({
    root,
    define: {
        __APP_VERSION__: JSON.stringify("0.0.0-test"),
    },
    resolve: {
        alias: {
            "@": path.join(root, "src"),
        },
    },
    test: {
        environment: "node",
        include: ["src/**/*.test.{ts,tsx}"],
    },
});
