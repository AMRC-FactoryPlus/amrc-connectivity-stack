/*
 * ACS Edge Agent
 * JSON (Batched) publishes Boolean metrics, false included
 * Copyright 2026 University of Sheffield
 *
 * Before ACS-13 a Boolean metric on a JSON (Batched) connection never
 * published false, because false failed the "has a value" check, so
 * after its first true every later value matched and nothing more was
 * published.
 */

import { reHashConf } from "../../utils/FormatConfig";
import { Device } from "../../lib/device";

function batched_device () {
    const conf = reHashConf({
        deviceConnections: [{
            name: "batched",
            connType: "MQTT",
            payloadFormat: "JSON (Batched)",
            devices: [{
                deviceId: "Batched",
                pubInterval: 0,
                payloadFormat: "JSON (Batched)",
                templates: [],
                tags: [
                    { Name: "running", type: "Boolean", method: "GET",
                        address: "topic", path: "$.running", value: null,
                        recordToDB: true },
                ],
            }],
        }],
    });
    const published: any[] = [];
    const dev = new Device({} as any, {} as any, {
        deviceId: "Batched",
        pollInt: 1e9,
        pubInterval: 0,
        templates: [],
        metrics: conf.deviceConnections[0].devices[0].metrics,
        payloadFormat: "JSON (Batched)",
    } as any);
    (dev as any)._publishDData = (ms: any[]) =>
        published.push(...ms.map(m => [m.value, m.timestamp]));
    return { dev, published };
}

const msg = (rows: any[]) => ({ topic: Buffer.from(JSON.stringify(rows)) });

beforeAll(() => jest.useFakeTimers("modern"));
afterAll(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
});

test("every change of a Boolean is published, false included", () => {
    const { dev, published } = batched_device();
    dev._handleData(msg([
        { running: false, timestamp: 1763380000000 },
        { running: true, timestamp: 1763380001000 },
        { running: true, timestamp: 1763380002000 },
        { running: false, timestamp: 1763380003000 },
    ]), true);
    dev._handleData(msg([
        { running: false, timestamp: 1763380004000 },
        { running: true, timestamp: 1763380005000 },
    ]), true);

    expect(published).toEqual([
        [false, 1763380000000],
        [true, 1763380001000],
        [false, 1763380003000],
        [true, 1763380005000],
    ]);
});

test("a missing or null Boolean is still not published", () => {
    const { dev, published } = batched_device();
    dev._handleData(msg([
        { running: null, timestamp: 1763380000000 },
        { timestamp: 1763380001000 },
    ]), true);
    expect(published).toEqual([]);
});
