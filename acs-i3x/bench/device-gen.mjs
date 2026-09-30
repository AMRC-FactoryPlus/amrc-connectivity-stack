/*
 * ACS i3X
 * Deterministic generator for realistic Device configs
 * Copyright 2026 University of Sheffield
 */

/*
 * The shape copies a DeviceInformation entry from a bulk import on the
 * dev cluster (30 Sept 2026): about 4 KB of JSON, 23 leaf metrics and
 * 5 sub-objects (Address, Location, Cyber_Profile, Device_Information,
 * ISA95_Hierarchy). That import produced about 24.7 i3X nodes per
 * device (48,704 nodes for 1,973 devices). This generator produces
 * about 25.4: ObjectTree skips the Address sub-object because
 * "Address" is one of its metadata keys, as it does for the real
 * data. Names and values are synthetic.
 */

import { v5 as uuidv5 } from "uuid";

const NS = "3b7c1d0e-6f0a-4f4e-9d59-0c5a3f1e2b10";

/** Returns the generator functions. `C` is lib/constants (from dist/
 * for the benchmark, from the TS source for jest). */
export function device_gen (C) {
    const Schema = {
        Top:        uuidv5("schema:top", NS),
        Address:    uuidv5("schema:address", NS),
        Location:   uuidv5("schema:location", NS),
        Cyber:      uuidv5("schema:cyber", NS),
        DevInfo:    C.DEVICE_INFO_SCHEMA_UUID,
        Hierarchy:  C.HIERARCHY_SCHEMA_UUID,
    };

    const device_uuid = i => uuidv5(`device:${i}`, NS);

    function leaf (type, value, tooltip) {
        const out = {
            Value: value,
            Method: "GET",
            Sparkplug_Type: type,
            Record_To_Historian: true,
        };
        if (tooltip) out.Tooltip = "Synthetic value: not published in the source data";
        return out;
    }

    function sub (uuid, name, schema, body) {
        return {
            Schema_UUID: schema,
            Instance_UUID: uuidv5(`${uuid}:${name}`, NS),
            ...body,
        };
    }

    /** DeviceInformation config for device `i`. `rev` changes leaf values
     * so a later write is a real content change. */
    function device_information (i, rev = 0) {
        const uuid = device_uuid(i);
        return {
            node: uuidv5(`node:${i % 4}`, NS),
            schema: Schema.Top,
            createdAt: "2026-09-30T09:53:29.670Z",
            connection: uuidv5(`conn:${i % 4}`, NS),
            sparkplugName: `Device_${i}`,
            recordToHistorian: true,
            originMap: {
                Schema_UUID: Schema.Top,
                Instance_UUID: uuid,
                PTZ: leaf("Boolean", i % 2 === 0),
                Owner: leaf("String", "Example Council"),
                Source_ID: leaf("String", `${i}`),
                Asset_Type: leaf("String", "CCTV Camera"),
                Site_Type: leaf("String", "Roadside"),
                Firmware: leaf("String", `4.1.${rev}`, true),
                Address: sub(uuid, "Address", Schema.Address, {
                    Easting: leaf("DoubleLE", 359753.21 + i),
                    Northing: leaf("DoubleLE", 177675.62 + i),
                    Local_Authority: leaf("String", "Example Council"),
                    Location_Description: leaf("String", `opp ${i}`),
                }),
                Location: sub(uuid, "Location", Schema.Location, {
                    Latitude: leaf("FloatLE", 51.49 + i / 1e5),
                    Longitude: leaf("FloatLE", -2.58 - i / 1e5),
                }),
                Cyber_Profile: sub(uuid, "Cyber_Profile", Schema.Cyber, {
                    CPE: leaf("String", "cpe:2.3:h:example:dome_4:4.1.0:*:*:*:*:*:*:*", true),
                    Last_Patched: leaf("DateTime", 1756339200000, true),
                    Remotely_Managed: leaf("Boolean", true),
                    Network_Connected: leaf("Boolean", true),
                }),
                Device_Information: sub(uuid, "Device_Information", Schema.DevInfo, {
                    Model: leaf("String", "Dome-4", true),
                    Manufacturer: leaf("String", "Example Optics", true),
                    Friendly_Name: leaf("String", `CCTV Camera ${i}`),
                    ISA95_Hierarchy: sub(uuid, "ISA95_Hierarchy", Schema.Hierarchy, {
                        Enterprise: leaf("String", "Example_Enterprise"),
                        Site: leaf("String", `Site_${i % 3}`),
                        Area: leaf("String", `Area_${i % 5}`),
                        "Work Center": leaf("String", `WC${i}`),
                    }),
                }),
            },
        };
    }

    const info = (i, rev = 0) =>
        ({ name: rev ? `Device ${i} r${rev}` : `Device ${i}` });

    /** Write the Schema and Info configs every device refers to. */
    function seed_schemas (cdb) {
        for (const [name, uuid] of Object.entries(Schema)) {
            cdb.put_config(C.SCHEMA_APP_UUID, uuid, {
                title: name,
                type: "object",
                properties: { Schema_UUID: { const: uuid } },
            });
            cdb.put_config(C.INFO_APP_UUID, uuid, { name: `${name}-v1` });
        }
    }

    /** The three writes an importer makes for one device. */
    function import_ops (cdb, i) {
        const uuid = device_uuid(i);
        return [
            () => cdb.create_object(uuid),
            () => cdb.put_config(C.INFO_APP_UUID, uuid, info(i)),
            () => cdb.put_config(C.DEVICE_INFORMATION_APP_UUID, uuid, device_information(i)),
        ];
    }

    return {
        Schema, device_uuid, device_information, info,
        seed_schemas, import_ops,
    };
}
