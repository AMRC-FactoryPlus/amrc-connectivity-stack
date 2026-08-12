/*
 * ACS Pathfindr driver
 * Inline the metric panel into the service-setup dump.
 * Copyright 2026 University of Sheffield AMRC
 *
 * The Manager reads a driver's UI out of its definition in ConfigDB, which
 * is seeded from acs-service-setup/dumps/edge.yaml. That means the panel has
 * to exist twice: once as an editable HTML file, and once inlined into the
 * dump. This regenerates the second from the first.
 *
 *     node tools/inline-ui.js
 *
 * test/ui-sync.test.js fails if the two have drifted, so a forgotten run is
 * caught rather than shipped.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));

export const SOURCE = path.join(here, "..", "ui", "metric-panel.html");
export const DUMP = path.join(here, "..", "..",
    "acs-service-setup", "dumps", "edge.yaml");

export const BEGIN = "        # BEGIN metric-panel.html";
export const END = "        # END metric-panel.html";
const INDENT = "          ";

/** Render the panel as an indented YAML literal block. */
export function block (html) {
    const body = html.replace(/\n+$/, "").split("\n")
        /* A blank line inside a block scalar must carry no indentation, or
         * YAML keeps the trailing spaces. */
        .map(l => l.trim() === "" ? "" : INDENT + l)
        .join("\n");
    return `${BEGIN}\n        document: |\n${body}\n${END}`;
}

/** Pull the inlined panel back out of the dump, undoing the indentation. */
export function extract (dump) {
    const from = dump.indexOf(BEGIN);
    const to = dump.indexOf(END);
    if (from < 0 || to < 0) return null;

    const lines = dump.slice(from, to).split("\n");
    /* Drop the BEGIN marker and the `document: |` line. */
    const body = lines.slice(2);
    while (body.length && body[body.length - 1].trim() === "") body.pop();

    return body
        .map(l => l.startsWith(INDENT) ? l.slice(INDENT.length) : l)
        .join("\n") + "\n";
}

function main () {
    const html = fs.readFileSync(SOURCE, "utf8");
    const dump = fs.readFileSync(DUMP, "utf8");

    const from = dump.indexOf(BEGIN);
    const to = dump.indexOf(END);
    if (from < 0 || to < 0) {
        console.error("Markers not found in %s", DUMP);
        process.exit(1);
    }

    const updated = dump.slice(0, from) + block(html) + dump.slice(to + END.length);
    if (updated === dump) {
        console.log("Already up to date.");
        return;
    }

    fs.writeFileSync(DUMP, updated);
    console.log("Inlined %d bytes into %s", html.length, DUMP);
}

if (process.argv[1] && import.meta.url === url.pathToFileURL(process.argv[1]).href)
    main();
