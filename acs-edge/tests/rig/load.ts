/*
 * ACS Edge Agent
 * Split-driver cluster rig: create the rig's Edge Agents, connections
 * and devices on an ACS installation
 * Copyright 2026 University of Sheffield
 *
 *   load --rig <rig.json> [--cluster <uuid>] [--hostname <host>]
 *       [--yes]
 *
 * Without --yes it prints every write and makes none. Credentials come
 * from the environment as for any service client: DIRECTORY_URL,
 * SERVICE_USERNAME and SERVICE_PASSWORD.
 *
 * Every connection is created in its built-in form, which is the
 * state a site is in before version 7: the built-in DriverDef, and an
 * Edge Agent config entry of `connType` OPC UA, MQTT, REST or UDP. The
 * writes are the ones the Manager makes:
 *
 *  - Edge Agent: an EdgeAgent object, its Info name, and last of all
 *    its EdgeAgentDeployment (NewEdgeDeploymentDialog.vue), which
 *    makes the edge cluster deploy it.
 *  - Connection: an EdgeAgentConnection object, Info, and its
 *    ConnectionConfiguration (NewConnectionDialog.vue). Its password
 *    is sealed into the node's Secret through the Manager's own
 *    endpoint, and the config holds the `__FPSI__` placeholder.
 *  - Device: a Device object, Info, and DeviceInformation
 *    (NewDeviceDialog.vue).
 *  - The Edge Agent config: written whole from the source entries,
 *    pointed at the mocks, as the source site has it today. The
 *    Manager builds it from origin maps instead, which the source
 *    configs don't carry, so don't save these devices or connections
 *    in the Manager: it would rebuild their tags from nothing.
 *
 * UUIDs are made from the rig's prefix and each object's place in the
 * rig, so running it again finds the same objects. A second run
 * rewrites nothing that has moved: a connection whose driver is no
 * longer the built-in one, or an agent whose config has a split
 * driver entry, is left alone, so running it after the upgrade can't
 * undo the upgrade. An existing EdgeAgentDeployment is never
 * rewritten, because the upgrade adds the sidecars to it.
 */

import { load } from "./objects.js";
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
        console.error("Usage: load --rig <rig.json> [--cluster uuid] [--hostname host] [--yes]");
        process.exit(2);
    }
    await load(read_rig(args.rig), {
        cluster:    args.cluster as string | undefined,
        hostname:   args.hostname as string | undefined,
        dry:        !args.yes,
    });
    process.exit(0);
}

if (process.argv[1]?.match(/load\.[jt]s$/))
    await main();
