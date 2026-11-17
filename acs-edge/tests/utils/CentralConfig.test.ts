/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

/* utils/CentralConfig.ts once held a CentralConfig class, which these
 * tests were written for. It is now a set of functions. Importing the
 * module parses and compiles schema/schema.json, so these tests also
 * catch a schema that is not valid JSON or not a valid JSON Schema. */

import { validateConfig, wait } from "../../utils/CentralConfig";

const sparkplug = {
    serverUrl: "mqtt://broker.example:1883",
    groupId: "Dummy",
    edgeNode: "Dummy_Node",
    username: "user",
    password: "password",
    asyncPubMode: true,
    pubInterval: 1000,
    compressPayload: false,
};

function config (conn: object) {
    return { sparkplug, deviceConnections: [conn] };
}

describe("validateConfig", () => {
    test("accepts a config with a REST connection", () => {
        expect(validateConfig(config({
            name: "api", connType: "REST",
            RESTConnDetails: { baseURL: "http://example.com", authMethod: "None" },
        }))).toBe(true);
    });

    test("rejects a connection with no connType", () => {
        expect(validateConfig(config({ name: "api" }))).toBe(false);
    });

    /* UDP is left out: it was retired with these, but ACS-36 puts it
     * back. */
    test.each(["S7", "MTConnect", "EtherNet/IP", "Fieldbus"])(
        "rejects the removed connection type %s", connType => {
            expect(validateConfig(config({ name: "old", connType }))).toBe(false);
        });

    test("rejects a Sparkplug group ID containing a /", () => {
        expect(validateConfig({
            sparkplug: { ...sparkplug, groupId: "a/b" },
            deviceConnections: [],
        })).toBe(false);
    });
});

describe("wait", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test("resolves after the given number of seconds, not before", async () => {
        let done = false;
        const p = wait(2).then(() => { done = true; });

        jest.advanceTimersByTime(1999);
        await Promise.resolve();
        expect(done).toBe(false);

        jest.advanceTimersByTime(1);
        await p;
        expect(done).toBe(true);
    });
});
