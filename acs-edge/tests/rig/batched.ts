/*
 * ACS Edge Agent
 * Split-driver cluster rig: make the ACS-35 change on a rig connection
 * Copyright 2026 University of Sheffield
 *
 *   batched --rig <rig.json> --connection <id> [--yes]
 *
 * Sets the connection's payload format to `JSON (Batched)` and removes
 * the image pin from its Edge Agent's Deployment, together, as ACS-35
 * changes the busiest production agent. Without --yes it prints the
 * writes and makes none. See `batch()` in objects.ts.
 */

import { batch } from "./objects.js";
import { read_rig } from "./rig.js";

function parse_args (argv: string[]) {
    const opts: { [k: string]: string | boolean } = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a == "--yes") opts.yes = true;
        else if (a.startsWith("--")) opts[a.slice(2)] = argv[++i];
        else throw new Error(`Unexpected argument ${a}`);
    }
    return opts;
}

async function main () {
    const args = parse_args(process.argv.slice(2));
    if (typeof args.rig != "string" || typeof args.connection != "string") {
        console.error("Usage: batched --rig <rig.json> --connection <id> [--yes]");
        process.exit(2);
    }
    await batch(read_rig(args.rig), { connection: args.connection, dry: !args.yes });
    process.exit(0);
}

if (process.argv[1]?.match(/batched\.[jt]s$/))
    await main();
