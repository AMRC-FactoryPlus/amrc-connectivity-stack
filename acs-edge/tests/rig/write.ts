/*
 * ACS Edge Agent
 * Split-driver cluster rig: write one metric of a rig device
 * Copyright 2026 University of Sheffield
 *
 *   write --rig <rig.json> --connection <id> --device <deviceId>
 *       --metric <name> --value <value> [--type <Sparkplug type>]
 *
 * Sends the write through the Command Escalation service, as the
 * Manager does, so the Edge Agent gets a DCMD and writes the value to
 * the mock. The mock's status (`GET /status` on its control port)
 * then lists the write. This changes a value on a mock device and
 * nothing else.
 */

import { Address, UUIDs } from "@amrc-factoryplus/service-client";

import { service_client } from "./acs.js";
import { read_rig, sparkplug_type } from "./rig.js";

function parse_args (argv: string[]) {
    const args: { [k: string]: string } = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--")) throw new Error(`Unexpected argument ${a}`);
        args[a.slice(2)] = argv[++i];
    }
    return args;
}

function parse_value (type: string, value: string): any {
    if (type == "Boolean") return value == "true";
    if (/Int|Float|Double/.test(type)) return Number(value);
    return value;
}

async function main () {
    const args = parse_args(process.argv.slice(2));
    for (const k of ["rig", "connection", "device", "metric", "value"])
        if (!args[k]) {
            console.error("Usage: write --rig <rig.json> --connection <id> --device <deviceId> "
                + "--metric <name> --value <value> [--type <type>]");
            process.exit(2);
        }
    const rig = read_rig(args.rig);
    const c = rig.connections.find(c => c.id == args.connection);
    if (!c) throw new Error(`No connection ${args.connection} in the rig`);
    const dev = (c.connection.devices ?? []).find((d: any) => d.deviceId == args.device);
    if (!dev) throw new Error(`Connection ${c.id} has no device ${args.device}`);
    const tag = (dev.tags ?? []).find((t: any) => t.Name == args.metric);
    if (!tag?.address) throw new Error(`${args.device} has no metric ${args.metric} with an address`);
    const type = args.type ?? sparkplug_type(tag.type);

    const fplus = await service_client();
    const addrs: Map<string, any> = await fplus.ConfigDB.get_all_configs(
        (UUIDs as any).App.SparkplugAddress);
    const node = [...addrs.values()].find(a => a?.node_id == c.node && !a.device_id);
    if (!node) throw new Error(`No Sparkplug address for ${c.node}`);

    const address = new Address(node.group_id, node.node_id, args.device);
    console.log("Writing %s = %s (%s) to %s, address %s on the device",
        args.metric, args.value, type, address, tag.address);
    await fplus.CmdEsc.request_cmd({
        address, name: args.metric, type, value: parse_value(type, args.value),
    });
    console.log("Sent. Check the mock: GET /status on the %s mock's control port, connection %s",
        c.protocol, c.id);
    process.exit(0);
}

await main();
