/*
 * ACS Edge Agent
 * Split-driver cluster rig: remove everything the loader created
 * Copyright 2026 University of Sheffield
 *
 *   remove --rig <rig.json> [--cluster <uuid>] [--yes]
 *
 * Without --yes it prints what it would delete and deletes nothing.
 * It finds the rig's Edge Agents by their UUIDs and by any Edge Agent
 * deployment whose name starts with the rig's prefix and `_`, then
 * every connection and device on those agents, whether or not the
 * current rig file has them. In order:
 *
 *  1. each agent's EdgeAgentDeployment, so the edge cluster removes
 *     the agent's Helm release and its pod;
 *  2. each sealed password the rig file knows of;
 *  3. each agent's Edge Agent config;
 *  4. each device and connection: their configs, then the object;
 *  5. each agent's Info and SparkplugAddress, then the object.
 *
 * It touches nothing outside those agents. The Kerberos principal the
 * Edge Agent chart made goes with the Helm release.
 */

import { remove } from "./objects.js";
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
    if (typeof args.rig != "string") {
        console.error("Usage: remove --rig <rig.json> [--cluster uuid] [--yes]");
        process.exit(2);
    }
    await remove(read_rig(args.rig), {
        cluster: args.cluster as string | undefined,
        dry: !args.yes,
    });
    process.exit(0);
}

if (process.argv[1]?.match(/remove\.[jt]s$/))
    await main();
