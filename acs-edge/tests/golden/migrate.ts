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
