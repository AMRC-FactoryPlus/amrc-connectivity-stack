/*
 * ACS Admin
 * Build of the vendored i3X Explorer, served by the admin at /i3x-explorer/
 * Copyright 2026 University of Sheffield
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

import upstreamTailwind from "./tailwind.config.js";

/* The upstream release this copy was taken from. FORK.md says when to
 * change it. It is shown in the Explorer's About dialog. */
const UPSTREAM_VERSION = "1.1.0-1";

const root = path.dirname(fileURLToPath(import.meta.url));

/* Upstream's Tailwind config names its content relative to the working
 * directory, which is acs-admin/ here, not this folder. Anchor it, so
 * the admin's own Tailwind config and classes never reach this build
 * and this build's never reach the admin's. */
const tailwind = {
    ...upstreamTailwind,
    content: [
        path.join(root, "index.html"),
        path.join(root, "src/**/*.{js,ts,jsx,tsx}"),
    ],
};

export default defineConfig(({ command }) => ({
    root,
    /* Relative in the build, as upstream's web build is, so the files
     * work wherever nginx serves the folder. The dev server sits behind
     * the admin's dev server at /i3x-explorer/. */
    base: command === "build" ? "./" : "/i3x-explorer/",
    define: {
        __APP_VERSION__: JSON.stringify(UPSTREAM_VERSION),
    },
    plugins: [react()],
    css: {
        /* Inline, so Vite does not pick up acs-admin/postcss.config.js,
         * which would run the admin's Tailwind config over this app. */
        postcss: {
            plugins: [tailwindcss(tailwind), autoprefixer()],
        },
    },
    resolve: {
        alias: {
            "@": path.join(root, "src"),
        },
    },
    worker: {
        /* The catalog engine runs in a module worker. */
        format: "es",
    },
    server: {
        port: 5174,
        strictPort: true,
    },
    build: {
        outDir: path.join(root, "../dist/i3x-explorer"),
        emptyOutDir: true,
        target: "es2020",
    },
}));
