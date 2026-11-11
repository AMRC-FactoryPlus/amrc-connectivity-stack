/*
 * ACS Briefcase exporter
 * Tests for describing a device
 * Copyright 2026 University of Sheffield
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { describe_device } from "../lib/device.js";

const DEVICE = "d0000000-0000-4000-8000-000000000000";
const CHARS = "c0000000-0000-4000-8000-000000000000";
const AXIS = "e0000000-0000-4000-8000-000000000000";

const INFO = {
    schema: "d6de8765-bfbe-4f6b-b5d8-822dbd7f3a49",
    originMap: {
        Schema_UUID: "d6de8765-bfbe-4f6b-b5d8-822dbd7f3a49",
        Instance_UUID: DEVICE,
        Switch_Closed: {
            Sparkplug_Type: "Boolean",
            Record_To_Historian: true,
            Method: "GET",
            Address: "192.168.1.20:502/coil/17",
        },
        Characteristics: {
            Schema_UUID: "0ff890b0-1ddb-4cb0-96eb-b0e87039df2f",
            Instance_UUID: CHARS,
            Current_AC: {
                Sparkplug_Type: "FloatLE",
                Record_To_Historian: true,
                Eng_Unit: "A",
                Documentation: "True RMS current",
                Address: "40001",
            },
            Debug: { Sparkplug_Type: "String", Record_To_Historian: false },
        },
        Axes: {
            X: {
                Instance_UUID: AXIS,
                Position: {
                    Actual: { Sparkplug_Type: "Double", Record_To_Historian: true },
                },
            },
        },
    },
};

test("lists the recorded metrics by full name", () => {
    const d = describe_device({ uuid: DEVICE, name: "Lathe", info: INFO });
    assert.deepEqual(d.metrics, [
        { name: "Switch_Closed", type: "Boolean" },
        { name: "Characteristics/Current_AC", type: "FloatLE",
            unit: "A", documentation: "True RMS current" },
        { name: "Axes/X/Position/Actual", type: "Double" },
    ]);
});

test("lists the objects with their schemas", () => {
    const d = describe_device({ uuid: DEVICE, name: "Lathe", info: INFO });
    assert.equal(d.schema, "d6de8765-bfbe-4f6b-b5d8-822dbd7f3a49");
    assert.deepEqual(d.objects, [
        { path: "Characteristics",
            schema: "0ff890b0-1ddb-4cb0-96eb-b0e87039df2f", instance: CHARS },
        { path: "Axes/X", instance: AXIS },
    ]);
});

test("leaves out connection details", () => {
    const text = JSON.stringify(
        describe_device({ uuid: DEVICE, name: "Lathe", info: INFO }));
    assert.doesNotMatch(text, /Address|Method|192\.168|40001/);
});

test("describes a device with no Device Information", () => {
    assert.deepEqual(describe_device({ uuid: DEVICE }),
        { uuid: DEVICE, objects: [], metrics: [] });
});
