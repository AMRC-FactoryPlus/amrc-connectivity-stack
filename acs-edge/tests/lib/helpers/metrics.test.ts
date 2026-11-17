/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* The address index on Metrics. It used to hold each metric twice, so
 * built-in MQTT and REST writes repeated every value in Buffer,
 * Delimited and JSON (Batched) payloads. */

import {
    Metrics, serialisationType, sparkplugDataType, sparkplugMetric,
    writeValuesToPayload,
} from "../../../lib/helpers/typeHandler";

describe("Metrics address index", () => {
    function rw (name: string, addr: string, path: string, value: number): sparkplugMetric {
        return {
            name, value, type: sparkplugDataType.uInt16,
            properties: {
                method:     { type: sparkplugDataType.string, value: "GET/SET" },
                address:    { type: sparkplugDataType.string, value: addr },
                path:       { type: sparkplugDataType.string, value: path },
            },
        } as sparkplugMetric;
    }

    it("lists each metric once per address", () => {
        const metrics = new Metrics([
            rw("a", "x", "$.a", 1),
            rw("b", "x", "$.b", 2),
            rw("c", "y", "", 3),
        ]);
        expect(metrics.getByAddress("x").map(m => m.name)).toEqual(["a", "b"]);
        expect(metrics.getByAddress("y").map(m => m.name)).toEqual(["c"]);
    });

    it("does not repeat a value in a built-in write payload", () => {
        const metrics = new Metrics([rw("a", "x", "", 7)]);
        const buf = writeValuesToPayload(metrics.getByAddress("x"),
            serialisationType.fixedBuffer);
        expect(buf).toEqual(Buffer.from([0, 7]));

        const batched = writeValuesToPayload(metrics.getByAddress("x"),
            serialisationType.JSONBatched);
        expect(JSON.parse(batched as string).length).toBe(1);
    });
});
