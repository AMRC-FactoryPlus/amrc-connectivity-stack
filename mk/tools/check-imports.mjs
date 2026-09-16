#!/usr/bin/env node

/*
 * ACS build tools
 * Check that imported packages are declared in package.json.
 * Copyright 2026 University of Sheffield
 */

/* Undeclared imports do not fail at install time; they fail at runtime,
 * in the built image, the first time the importing code path runs. We
 * shipped v6.9.2 with `got` imported by service-client but declared
 * nowhere (it arrived only as a peer of an optional dependency, which
 * npm 10 hoisted and npm 11 did not) and half the stack crash-looped.
 * See issue #745. This check makes that failure mode a build error.
 *
 * Usage: node mk/tools/check-imports.mjs <pkgdir> [<pkgdir>...]
 */

import { builtinModules }   from "node:module";
import * as fs              from "node:fs/promises";
import * as path            from "node:path";

/* Imports we deliberately don't declare. These must be wrapped in a
 * fallback at the import site; list them here with the reason so the
 * omission is a decision rather than an oversight. */
const Soft_Imports = new Map([
    /* deps.js prefers our GSS fork but falls back to gssapi.js. The
     * fork is declared by the services which install it, not here. */
    ["@amrc-factoryplus/gssapi", "optional GSS fork, falls back to gssapi.js"],
    /* service-client reaches these only from ConfigDB.watcher(), which is
     * deprecated and loads configdb-watcher.js dynamically precisely so
     * that consumers which don't call it needn't install them. */
    ["@amrc-factoryplus/sparkplug-app", "deprecated ConfigDB.watcher() only"],
    ["rxjs", "deprecated ConfigDB.watcher() only"],
]);

const Source_Dirs = ["bin", "lib", "src", "test"];
const Source_Exts = new Set([".js", ".mjs", ".cjs", ".ts", ".mts"]);

const builtins = new Set(builtinModules);

/* Strip comments so commented-out imports don't count. Good enough for
 * our sources; we are not writing a JS parser here. */
function strip_comments (src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

const Import_Res = [
    /\bimport\s+[^;()'"`]*?\bfrom\s*["']([^"']+)["']/g,
    /\bexport\s+[^;()'"`]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g,
];

function find_specifiers (src) {
    const text = strip_comments(src);
    const found = new Set();
    for (const re of Import_Res) {
        for (const m of text.matchAll(re))
            found.add(m[1]);
    }
    return found;
}

/* Reduce an import specifier to the package it comes from, or null if
 * it isn't a package import at all. */
function package_name (spec) {
    if (spec.startsWith(".") || spec.startsWith("/")) return null;
    if (spec.startsWith("node:")) return null;
    /* An npm scope can't be empty, so `@/foo` is a bundler path alias. */
    if (spec.startsWith("@/")) return null;
    const parts = spec.split("/");
    const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    if (builtins.has(name)) return null;
    return name;
}

async function source_files (dir) {
    const files = [];
    const walk = async d => {
        let ents;
        try {
            ents = await fs.readdir(d, { withFileTypes: true });
        }
        catch (e) {
            if (e.code == "ENOENT") return;
            throw e;
        }
        for (const ent of ents) {
            const full = path.join(d, ent.name);
            if (ent.name == "node_modules" || ent.name.startsWith(".")) continue;
            if (ent.isDirectory()) await walk(full);
            else if (Source_Exts.has(path.extname(ent.name))) files.push(full);
        }
    };
    for (const sub of Source_Dirs)
        await walk(path.join(dir, sub));
    return files;
}

async function check_package (dir) {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json")));
    const declared = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.optionalDependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
    ]);

    const missing = new Map();
    const files = await source_files(dir);
    for (const file of files) {
        const src = await fs.readFile(file, "utf8");
        for (const spec of find_specifiers(src)) {
            const name = package_name(spec);
            if (name == null) continue;
            if (name == pkg.name) continue;
            if (declared.has(name)) continue;
            if (Soft_Imports.has(name)) continue;
            if (!missing.has(name)) missing.set(name, new Set());
            missing.get(name).add(file);
        }
    }

    /* Report the file count: a package whose sources live somewhere we
     * don't scan would otherwise pass silently. */
    if (missing.size == 0) {
        console.log(`ok       ${pkg.name} (${files.length} files)`);
        return true;
    }
    console.log(`MISSING  ${pkg.name} (${files.length} files)`);
    for (const [name, sites] of [...missing].sort())
        console.log(`    ${name}  <- ${[...sites].sort().join(", ")}`);
    return false;
}

const dirs = process.argv.slice(2);
if (dirs.length == 0) {
    console.error("usage: check-imports.mjs <pkgdir> [<pkgdir>...]");
    process.exit(2);
}

let ok = true;
for (const dir of dirs)
    ok = await check_package(dir) && ok;

if (!ok) {
    console.error("\nUndeclared imports found. Add them to the package's "
        + "dependencies, or to Soft_Imports in this script if the import "
        + "site handles them being absent.");
    process.exit(1);
}
