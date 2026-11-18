/*
 * ACS Edge Agent benchmark
 * Compile the Edge Agent code the benchmark imports
 * Copyright 2026 University of Sheffield
 *
 * The output goes under node_modules/.cache/edge-bench, where neither
 * the agent's own tsconfig nor git nor the Docker build sees it. Node
 * does not look above a node_modules directory for "type": "module",
 * so the output needs its own package.json to load as ES modules.
 */

import { execFileSync } from "node:child_process";
import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "../node_modules/.cache/edge-bench");
const tsc = path.join(here, "../node_modules/typescript/bin/tsc");

execFileSync(process.execPath, [tsc, "-p", path.join(here, "tsconfig.json")],
    { stdio: "inherit" });
fs.writeFileSync(path.join(out, "package.json"), '{ "type": "module" }\n');
