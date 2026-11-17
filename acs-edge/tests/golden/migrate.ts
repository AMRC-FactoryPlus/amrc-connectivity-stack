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
};

/* A device whose payload format is "Defined by Protocol" gets the
 * values the built-in connection decoded, and the Edge Agent never
 * reads its metrics' paths. Once the device's format is JSON the agent
 * reads the decoded-value packet `{"value", "timestamp"}` through each
 * path, and a path left over from before, such as `mm`, finds nothing.
 * So a move away from "Defined by Protocol" has to drop the paths, and
 * then the path is gone from the metric's properties in DBIRTH too.
 *
 * service-setup's move (ACS-21) does not do this yet, and the Admin UI
 * copies each metric's `Path` from the device's origin map into the
 * Edge Agent config. Moving OPC UA connections (ACS-27) must clear
 * those, or metrics with a path stop updating.
 *
 * The harness drops these paths for both runs, so that it compares what
 * the driver sends and not what the move leaves behind. The built-in
 * run's DDATA is unchanged by it, because the built-in never read
 * them. */
export function without_unread_paths (entry: any): any {
    const next = JSON.parse(JSON.stringify(entry));
    for (const device of next.devices ?? []) {
        const format = device.payloadFormat ?? next.payloadFormat;
        if (format != "Defined by Protocol") continue;
        for (const tag of device.tags ?? [])
            delete tag.path;
    }
    return next;
}

/* The connection entry as service-setup leaves it after moving the
 * connection to its split driver: `move_entry()` with a DriverDef that
 * is not internal, and the protocol's payload format map, then
 * `set_driver_ids()`, which gives it a `driverId` if its name can't be
 * the driver's id. */
export function to_split (entry: any, protocol: string): any {
    const map = PayloadFormatMap[protocol];
    if (!map) throw new Error(`No split driver move for protocol ${protocol}`);

    const script = `
        import { move_entry, move_payload_format, set_driver_ids } from ${JSON.stringify(pathToFileURL(EDGE_CONNECTION).href)};
        let input = "";
        for await (const chunk of process.stdin) input += chunk;
        const { entry, map } = JSON.parse(input);
        const driverdef = { name: "Golden-output split driver" };
        const [next] = set_driver_ids([move_entry(entry, driverdef,
            f => move_payload_format(f, map, true))]);
        process.stdout.write(JSON.stringify(next));
    `;
    const out = execFileSync(process.execPath,
        ["--input-type=module", "-e", script],
        { input: JSON.stringify({ entry, map }), encoding: "utf8" });
    return JSON.parse(out);
}
