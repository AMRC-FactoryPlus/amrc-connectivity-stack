/*
 * ACS Edge Agent
 * Golden-output harness: switch a connection to a split driver
 * Copyright 2026 University of Sheffield
 */

import { execFileSync } from "child_process";
import path from "path";
import { pathToFileURL } from "url";

/* The shared helper service-setup and the admin UI use to rewrite a
 * connection entry. It is an ES module, which this CommonJS jest run
 * cannot require, so it runs in a child Node. */
export const EDGE_CONNECTION = path.resolve(__dirname,
    "../../../lib/js-service-client/lib/edge-connection.js");

/* The payload format map for each protocol, internal to split. These
 * are `SplitDrivers[*].payloadFormat` from
 * acs-service-setup/lib/split-drivers.js, which can't be imported here
 * without installing service-setup. golden.test.ts checks the two
 * agree. Keyed by the fixture's protocol. */
export const PayloadFormatMap: { [protocol: string]: { [f: string]: string } } = {
    "REST":     {},
    "MQTT":     {},
    "OPC UA":   { "Defined by Protocol": "JSON" },
    /* edge-udp passes datagrams through as bytes, as the built-in
     * connection does, so no format changes. */
    "UDP":      {},
};

/* A device whose payload format is "Defined by Protocol" gets the
 * values the built-in connection decoded, and the Edge Agent never
 * reads its metrics' paths. Once the device's format is JSON the agent
 * reads the decoded-value packet `{"value", "timestamp"}` through each
 * path, and a path left over from before, such as `mm`, finds nothing.
 * So a move away from "Defined by Protocol" has to drop the paths, and
 * then the path is gone from the metric's properties in DBIRTH too.
 *
 * service-setup's move drops them (the OPC UA split DriverDef has
 * `metricPaths: false`), and so does `to_split` below. The harness
 * also drops them from the built-in run, so that both runs' DBIRTHs
 * have the same properties. The built-in never read a path for its
 * value, but the Edge Agent used to keep one metric per address and
 * path, so dropping the paths of two metrics on one node hid all but
 * one of them in the recorded built-in runs (ACS-27): the OPC UA
 * recordings were corrected by hand, see tests/golden/README.md. A
 * run of an entry
 * service-setup already moved keeps whatever paths it has, so a path
 * the move missed shows as a metric that never updates. */
export function without_unread_paths (entry: any): any {
    const next = JSON.parse(JSON.stringify(entry));
    if (next.connType == "Driver") return next;
    for (const device of next.devices ?? []) {
        const format = device.payloadFormat ?? next.payloadFormat;
        if (format != "Defined by Protocol") continue;
        for (const tag of device.tags ?? [])
            delete tag.path;
    }
    return next;
}

/* What of each protocol's split DriverDef the move reads, beyond not
 * being internal: see acs-service-setup/dumps/edge.yaml. */
const DriverDefs: { [protocol: string]: any } = {
    "OPC UA":   { metricPaths: false },
};

/* The connection entry as service-setup leaves it after moving the
 * connection to its split driver: `move_entry()` with the split
 * DriverDef and the protocol's payload format map, then
 * `set_driver_ids()`, which gives it a `driverId` if its name can't be
 * the driver's id. */
export function to_split (entry: any, protocol: string): any {
    const map = PayloadFormatMap[protocol];
    if (!map) throw new Error(`No split driver move for protocol ${protocol}`);

    const script = `
        import { move_entry, move_payload_format, set_driver_ids } from ${JSON.stringify(pathToFileURL(EDGE_CONNECTION).href)};
        let input = "";
        for await (const chunk of process.stdin) input += chunk;
        const { entry, map, def } = JSON.parse(input);
        const driverdef = { name: "Golden-output split driver", ...def };
        const [next] = set_driver_ids([move_entry(entry, driverdef,
            f => move_payload_format(f, map, true))]);
        process.stdout.write(JSON.stringify(next));
    `;
    const out = execFileSync(process.execPath,
        ["--input-type=module", "-e", script],
        { input: JSON.stringify({ entry, map, def: DriverDefs[protocol] ?? {} }),
            encoding: "utf8" });
    return JSON.parse(out);
}
