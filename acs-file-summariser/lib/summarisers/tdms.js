/*
 * ACS File Summariser
 * TDMS summariser plugin
 * Copyright 2026 University of Sheffield
 */

import { spawn }            from "node:child_process";
import readline             from "node:readline";
import path                 from "node:path";
import { fileURLToPath }    from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "tdms_summarise.py");
const python = process.env.PYTHON_BIN ?? "/opt/venv/bin/python3";

export const defaultConfig = { n: 1000 };

/* Spawns the Python summariser and yields one row per NDJSON line on
 * its stdout, without ever buffering the full output. */
export async function *summarise (filePath, config) {
    const n = config?.n ?? defaultConfig.n;

    const child = spawn(python, [script, filePath, String(n)], {
        stdio: ["ignore", "pipe", "pipe"],
    });

    const stderr = [];
    child.stderr.on("data", chunk => stderr.push(chunk));

    const exit = new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", code => {
            if (code === 0) return resolve();
            reject(new Error(
                `tdms_summarise.py exited with code ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
        });
    });

    try {
        const lines = readline.createInterface({
            input: child.stdout,
            crlfDelay: Infinity,
        });

        for await (const line of lines) {
            if (!line) continue;
            const row = JSON.parse(line);
            yield {
                measurement:    "tdms_summary",
                tags:           { group: row.group, channel: row.channel },
                fields:         { value: row.value },
                timestamp:      row.timestamp_ns,
            };
        }

        await exit;
    } finally {
        if (child.exitCode === null && !child.killed)
            child.kill();
    }
}
