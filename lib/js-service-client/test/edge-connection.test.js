/*
 * Factory+ NodeJS Utilities
 * Tests for the Edge Agent connection entry helpers
 * Copyright 2026 University of Sheffield AMRC
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    connection_details, connection_type, driver_values, move_connection,
    move_entry, move_payload_format, set_connection_type,
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

    test("takes the fallback details when the entry has none", () => {
        const bare = structuredClone(entry);
        delete bare.OPCUAConnDetails;
        assert.deepEqual(move_entry(bare, SPLIT, fwd, DETAILS).DriverDetails, DETAILS);
    });
});
