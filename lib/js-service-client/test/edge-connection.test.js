/*
 * Factory+ NodeJS Utilities
 * Tests for the Edge Agent connection entry helpers
 * Copyright 2026 University of Sheffield AMRC
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    connection_details, connection_type, driver_id, driver_ids,
    driver_ports, driver_values, is_driver_id, move_connection, move_entry,
    port_clashes,
    move_payload_format, set_connection_type, set_driver_ids,
} from "../lib/edge-connection.js";

const OPCUA = { internal: { connType: "OPC UA", details: "OPCUAConnDetails" } };
const SPLIT = { image: { repository: "edge-opcua" } };
const DETAILS = { endpoint: "opc.tcp://server:4840", securityMode: "None" };

describe("connection_type", () => {
    test("a built-in driver gives its own type and key", () => {
        assert.deepEqual(connection_type(OPCUA),
            { connType: "OPC UA", details: "OPCUAConnDetails" });
    });

    test("any other driver is a Driver with DriverDetails", () => {
        const want = { connType: "Driver", details: "DriverDetails" };
        assert.deepEqual(connection_type(SPLIT), want);
        assert.deepEqual(connection_type({ external: true }), want);
        assert.deepEqual(connection_type(undefined), want);
    });
});

describe("set_connection_type", () => {
    test("moves an entry to a split driver and drops the old key", () => {
        const entry = { name: "c", connType: "OPC UA", OPCUAConnDetails: DETAILS };
        set_connection_type(entry, SPLIT, DETAILS);
        assert.deepEqual(entry, { name: "c", connType: "Driver", DriverDetails: DETAILS });
    });

    test("moves an entry back to a built-in driver", () => {
        const entry = { name: "c", connType: "Driver", DriverDetails: DETAILS };
        set_connection_type(entry, OPCUA, DETAILS);
        assert.deepEqual(entry, { name: "c", connType: "OPC UA", OPCUAConnDetails: DETAILS });
    });

    test("removes every stale details key, including s7's lower-case one", () => {
        const entry = { connType: "S7", s7ConnDetails: {}, RESTConnDetails: {}, DriverDetails: {} };
        set_connection_type(entry, SPLIT, DETAILS);
        assert.deepEqual(entry, { connType: "Driver", DriverDetails: DETAILS });
    });

    test("leaves no details when there are none", () => {
        const entry = { connType: "OPC UA", OPCUAConnDetails: DETAILS };
        set_connection_type(entry, SPLIT, undefined);
        assert.deepEqual(entry, { connType: "Driver" });
    });
});

describe("connection_details", () => {
    test("finds the details under any key", () => {
        assert.equal(connection_details({ OPCUAConnDetails: DETAILS }), DETAILS);
        assert.equal(connection_details({ DriverDetails: DETAILS }), DETAILS);
        assert.equal(connection_details({ name: "x" }), undefined);
        assert.equal(connection_details(undefined), undefined);
    });
});

describe("driver_values", () => {
    test("a split driver gets its deployment and image", () => {
        const cconf = { deployment: { hostPaths: [{ hostPath: "/a", mountPath: "/b" }] } };
        assert.deepEqual(driver_values(cconf, SPLIT), {
            hostPaths: [{ hostPath: "/a", mountPath: "/b" }],
            image: { repository: "edge-opcua" },
        });
        assert.deepEqual(driver_values({}, SPLIT), { image: { repository: "edge-opcua" } });
    });

    test("a built-in driver has none", () => {
        assert.equal(driver_values({ deployment: {} }, OPCUA), undefined);
    });

    test("a driver that listens gets the connection's port", () => {
        assert.deepEqual(driver_values({ config: { port: 5000 } }, UDP), {
            image: { repository: "edge-udp" },
            hostPorts: [{ protocol: "UDP", port: 5000 }],
        });
    });

    test("the port follows the connection's config", () => {
        const before = driver_values({ config: { port: 5000 } }, UDP);
        const after = driver_values({ config: { port: 5001 } }, UDP);
        assert.deepEqual(before.hostPorts, [{ protocol: "UDP", port: 5000 }]);
        assert.deepEqual(after.hostPorts, [{ protocol: "UDP", port: 5001 }]);
    });

    test("no port, no hostPorts key", () => {
        assert.deepEqual(driver_values({ config: {} }, UDP),
            { image: { repository: "edge-udp" } });
        assert.equal("hostPorts" in driver_values({ config: { port: 5000 } }, SPLIT),
            false);
    });

    test("host ports only come from the DriverDef", () => {
        const cconf = { deployment: { hostPorts: [{ protocol: "UDP", port: 1 }] } };
        assert.deepEqual(driver_values(cconf, SPLIT), { image: { repository: "edge-opcua" } });
    });
});

const UDP = {
    image: { repository: "edge-udp" },
    hostPorts: [{ protocol: "UDP", field: "port" }],
};

describe("driver_ports", () => {
    test("reads the named field", () => {
        assert.deepEqual(driver_ports({ config: { port: 5000 } }, UDP),
            [{ protocol: "UDP", port: 5000 }]);
    });

    test("takes a string of digits, as the driver does", () => {
        assert.deepEqual(driver_ports({ config: { port: " 5000" } }, UDP),
            [{ protocol: "UDP", port: 5000 }]);
    });

    test("opens nothing for a missing or bad port", () => {
        for (const port of [undefined, 0, -1, 65536, 1.5, "50a", "", null, true])
            assert.deepEqual(driver_ports({ config: { port } }, UDP), [], `port ${port}`);
        assert.deepEqual(driver_ports({}, UDP), []);
    });

    test("opens nothing for a driver that declares none", () => {
        assert.deepEqual(driver_ports({ config: { port: 5000 } }, SPLIT), []);
        assert.deepEqual(driver_ports({ config: { port: 5000 } }, undefined), []);
    });

    test("a built-in driver gets no host port", () => {
        const def = { ...UDP, image: undefined, internal: { connType: "UDP" } };
        assert.deepEqual(driver_ports({ config: { port: 5000 } }, def), []);
    });

    test("ignores an unknown protocol and a missing field name", () => {
        const def = { image: {}, hostPorts: [
            { protocol: "SCTP", field: "port" }, { protocol: "UDP" },
            { protocol: "TCP", field: "port" },
        ] };
        assert.deepEqual(driver_ports({ config: { port: 80 } }, def),
            [{ protocol: "TCP", port: 80 }]);
    });

    test("lists a port once", () => {
        const def = { image: {}, hostPorts: [
            { protocol: "UDP", field: "a" }, { protocol: "UDP", field: "b" },
        ] };
        assert.deepEqual(driver_ports({ config: { a: 9, b: 9 } }, def),
            [{ protocol: "UDP", port: 9 }]);
    });
});

describe("port_clashes", () => {
    const conn = (name, port, more) => ({
        name, cluster: "c1", hostname: "n1",
        ports: [{ protocol: "UDP", port }], ...more,
    });

    test("finds two connections on one host with the same port", () => {
        assert.deepEqual(port_clashes([conn("a", 5000), conn("b", 5000), conn("c", 5001)]),
            [{ protocol: "UDP", port: 5000, names: ["a", "b"] }]);
    });

    test("different hosts or clusters do not clash", () => {
        assert.deepEqual(port_clashes([conn("a", 5000), conn("b", 5000, { hostname: "n2" })]), []);
        assert.deepEqual(port_clashes([conn("a", 5000), conn("b", 5000, { cluster: "c2" })]), []);
    });

    test("an agent not pinned to a host can land on any", () => {
        assert.equal(port_clashes([conn("a", 5000), conn("b", 5000, { hostname: undefined })]).length, 1);
    });

    test("the same number on another protocol does not clash", () => {
        const tcp = { ...conn("b", 0), ports: [{ protocol: "TCP", port: 5000 }] };
        assert.deepEqual(port_clashes([conn("a", 5000), tcp]), []);
    });

    test("no ports, no clash", () => {
        assert.deepEqual(port_clashes([{ name: "a", cluster: "c1" }, { name: "b", cluster: "c1" }]), []);
    });
});

const PROTO = {
    internal:       "internal-uuid",
    split:          "split-uuid",
    payloadFormat:  { "Defined by Protocol": "JSON" },
};
const MAP = PROTO.payloadFormat;

describe("move_payload_format", () => {
    test("maps a format on the way to the split driver", () => {
        assert.equal(move_payload_format("Defined by Protocol", MAP, true), "JSON");
        assert.equal(move_payload_format("XML", MAP, true), "XML");
        assert.equal(move_payload_format("JSON", {}, true), "JSON");
    });

    test("restores the recorded format on the way back", () => {
        assert.equal(move_payload_format("JSON", MAP, false, "Defined by Protocol"),
            "Defined by Protocol");
        /* It was JSON before the move, so it stays JSON. */
        assert.equal(move_payload_format("JSON", MAP, false, "JSON"), "JSON");
        /* Someone changed it since the move: leave it. */
        assert.equal(move_payload_format("XML", MAP, false, "Defined by Protocol"), "XML");
    });

    test("inverts the map when nothing was recorded", () => {
        assert.equal(move_payload_format("JSON", MAP, false), "Defined by Protocol");
        assert.equal(move_payload_format("XML", MAP, false), "XML");
    });

    test("gives the same answer applied twice", () => {
        for (const to_split of [true, false])
            for (const f of ["Defined by Protocol", "JSON", "XML"]) {
                const once = move_payload_format(f, MAP, to_split, "Defined by Protocol");
                assert.equal(move_payload_format(once, MAP, to_split, "Defined by Protocol"), once);
            }
    });
});

describe("move_connection", () => {
    const cconf = {
        driver: "internal-uuid", edgeAgent: "agent", config: DETAILS,
        source: { payloadFormat: "Defined by Protocol" }, pollInt: 1000,
    };

    test("moves to the split driver and records where it came from", () => {
        assert.deepEqual(move_connection(cconf, PROTO, true), {
            ...cconf,
            driver: "split-uuid",
            source: { payloadFormat: "JSON" },
            splitMigration: { from: "internal-uuid", payloadFormat: "Defined by Protocol" },
        });
    });

    test("moves back to exactly where it started", () => {
        const there = move_connection(cconf, PROTO, true);
        assert.deepEqual(move_connection(there, PROTO, false), cconf);
    });

    test("writes out the admin UI's default format", () => {
        const bare = structuredClone(cconf);
        delete bare.source;
        assert.equal(move_connection(bare, PROTO, true).source.payloadFormat, "JSON");
    });

    test("does not change its argument", () => {
        const copy = structuredClone(cconf);
        move_connection(cconf, PROTO, true);
        assert.deepEqual(cconf, copy);
    });
});

describe("move_entry", () => {
    const entry = {
        uuid: "conn", name: "OPC", connType: "OPC UA", pollInt: 1000,
        payloadFormat: "Defined by Protocol", OPCUAConnDetails: DETAILS,
        devices: [
            { deviceId: "a", payloadFormat: "Defined by Protocol", tags: [] },
            { deviceId: "b", payloadFormat: "Defined by Protocol", tags: [] },
        ],
    };
    const fwd = f => move_payload_format(f, MAP, true);
    const back = f => move_payload_format(f, MAP, false, "Defined by Protocol");

    test("moves the type, details and payload formats", () => {
        assert.deepEqual(move_entry(entry, SPLIT, fwd), {
            uuid: "conn", name: "OPC", connType: "Driver", pollInt: 1000,
            payloadFormat: "JSON", DriverDetails: DETAILS,
            devices: [
                { deviceId: "a", payloadFormat: "JSON", tags: [] },
                { deviceId: "b", payloadFormat: "JSON", tags: [] },
            ],
        });
    });

    test("moves back to exactly where it started", () => {
        assert.deepEqual(move_entry(move_entry(entry, SPLIT, fwd), OPCUA, back), entry);
    });

    test("an entry with no payload format gets the default, moved", () => {
        /* The agent copies the connection's format to every device, so
         * with none the split driver's devices would decode nothing. */
        const bare = structuredClone(entry);
        delete bare.payloadFormat;
        const moved = move_entry(bare, SPLIT, fwd);
        assert.equal(moved.payloadFormat, "JSON");
        assert.deepEqual(moved.devices.map(d => d.payloadFormat), ["JSON", "JSON"]);
        assert.equal(move_entry(moved, OPCUA, back).payloadFormat, "Defined by Protocol");
    });

    test("takes the fallback details when the entry has none", () => {
        const bare = structuredClone(entry);
        delete bare.OPCUAConnDetails;
        assert.deepEqual(move_entry(bare, SPLIT, fwd, DETAILS).DriverDetails, DETAILS);
    });
});

describe("driver ids", () => {
    const U = n => `${n}a2b3c4d-0000-4000-8000-00000000000${n}`;
    const conn = (name, n, extra = {}) =>
        ({ name, uuid: U(n), connType: "Driver", ...extra });
    /* What every id must be to work as a broker id, a secret key and,
     * after "driver-", a container name. */
    const valid = id => /^[a-z0-9-]*[a-z0-9]$/i.test(id)
        && ("driver-" + id).length <= 63;

    test("a name that works today is its own id, capitals and all", () => {
        for (const name of ["plc-1", "Modbus1", "a", "x".repeat(56)]) {
            assert.ok(is_driver_id(name), name);
            assert.deepEqual(driver_ids([conn(name, 1)]), [name]);
        }
    });

    test("names that don't work get a lowercase id ending in their UUID", () => {
        const cases = [
            ["api.example.org",     "api-example-org-1a2b3c4d"],
            ["line_3",              "line-3-1a2b3c4d"],
            ["Press Line 3",        "press-line-3-1a2b3c4d"],
            ["Oven #2 (west)!",     "oven-2-west-1a2b3c4d"],
            ["plc-",                "plc-1a2b3c4d"],
            ["...",                 "1a2b3c4d"],
            ["",                    "1a2b3c4d"],
        ];
        for (const [name, want] of cases) {
            assert.equal(is_driver_id(name), false, name);
            const [id] = driver_ids([conn(name, 1)]);
            assert.equal(id, want, name);
            assert.ok(valid(id), id);
        }
    });

    test("a very long name is cut to fit a container name", () => {
        const [id] = driver_ids([conn("very.long.".repeat(20), 1)]);
        assert.ok(valid(id), id);
        assert.equal(("driver-" + id).length, 63);
        assert.match(id, /^very-long-.*-1a2b3c4d$/);
        /* 57 characters is one too many for a name to be kept. */
        assert.equal(is_driver_id("x".repeat(57)), false);
    });

    test("names that collapse to the same form get different ids", () => {
        const ids = driver_ids([
            conn("api.example.org", 1), conn("api_example_org", 2),
            conn("API Example Org", 3), conn("api-example-org", 4),
        ]);
        assert.deepEqual(ids, [
            "api-example-org-1a2b3c4d", "api-example-org-2a2b3c4d",
            "api-example-org-3a2b3c4d", "api-example-org",
        ]);
    });

    test("ids that still clash use the whole UUID", () => {
        const a = { name: "a.b", uuid: "11111111-aaaa-4000-8000-000000000000", connType: "Driver" };
        const b = { name: "a_b", uuid: "11111111-bbbb-4000-8000-000000000000", connType: "Driver" };
        const ids = driver_ids([a, b]);
        assert.deepEqual(ids, [
            "a-b-11111111aaaa40008000000000000000",
            "a-b-11111111bbbb40008000000000000000",
        ]);
        assert.ok(ids.every(valid));
    });

    test("a lowercase name that works keeps it over a capitalised one", () => {
        const ids = driver_ids([conn("PLC1", 1), conn("plc1", 2)]);
        assert.deepEqual(ids, ["plc1-1a2b3c4d", "plc1"]);
    });

    test("an id is kept once given, and does not depend on order", () => {
        const a = conn("api.example.org", 1);
        const b = conn("other.example.org", 2);
        assert.deepEqual(driver_ids([a, b]), [...driver_ids([b, a])].reverse());

        /* Stored, the id stays even if the UUID rule changed. */
        const stored = conn("api.example.org", 1, { driverId: "api-1" });
        assert.deepEqual(driver_ids([stored]), ["api-1"]);
        /* A stored id that can't be an id is replaced. */
        const bad = conn("api.example.org", 1, { driverId: "api.1" });
        assert.deepEqual(driver_ids([bad]), ["api-example-org-1a2b3c4d"]);
    });

    test("an entry with no UUID still gets a stable id", () => {
        const [a] = driver_ids([{ name: "api.example.org" }]);
        const [b] = driver_ids([{ name: "api.example.org" }]);
        assert.equal(a, b);
        assert.match(a, /^api-example-org-[0-9a-f]{8}$/);
    });

    test("set_driver_ids writes driverId only where the name can't be the id", () => {
        const entries = [
            conn("plc-1", 1),
            conn("api.example.org", 2),
            { name: "web.example.org", uuid: U(3), connType: "REST" },
            conn("Modbus1", 4, { driverId: "modbus1-4a2b3c4d" }),
        ];
        set_driver_ids(entries);
        assert.equal("driverId" in entries[0], false);
        assert.equal(entries[1].driverId, "api-example-org-2a2b3c4d");
        assert.equal("driverId" in entries[2], false, "built-in connections are left alone");
        assert.equal(entries[3].driverId, "modbus1-4a2b3c4d");
        assert.deepEqual(entries.map(driver_id),
            ["plc-1", "api-example-org-2a2b3c4d", "web.example.org", "modbus1-4a2b3c4d"]);

        /* A second pass changes nothing. */
        const again = structuredClone(entries);
        assert.deepEqual(set_driver_ids(again), entries);
    });

    test("a config whose names all work is left exactly as it was", () => {
        const entries = [conn("plc-1", 1), conn("Robot", 2)];
        const before = structuredClone(entries);
        assert.deepEqual(set_driver_ids(entries), before);
    });
});
