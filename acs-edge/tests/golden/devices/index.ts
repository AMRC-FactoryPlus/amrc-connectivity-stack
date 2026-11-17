/*
 * ACS Edge Agent
 * Golden-output harness: the fake device for each fixture protocol
 * Copyright 2026 University of Sheffield
 */

import type { Fixture } from "../../fixtures/drivers/fixture.js";
import type { DeviceFactory, DeviceOpts, FakeDevice } from "./device.js";
import { HttpDevice } from "./http.js";
import { MqttDevice } from "./mqtt.js";
import { OpcuaDevice } from "./opcua.js";
import { UdpDevice } from "./udp.js";

/* Keyed by the fixture's `protocol`. To add a kind, write a FakeDevice
 * and add it here. */
export const Kinds: { [protocol: string]: DeviceFactory } = {
    "REST":     (f, o) => new HttpDevice(f, o),
    "MQTT":     (f, o) => new MqttDevice(f, o),
    "OPC UA":   (f, o) => new OpcuaDevice(f, o),
    "UDP":      (f, o) => new UdpDevice(f, o),
};

export function make_device (fixture: Fixture, opts: DeviceOpts): FakeDevice {
    const make = Kinds[fixture.meta.protocol];
    if (!make)
        throw new Error(`No fake device for protocol ${fixture.meta.protocol}`);
    return make(fixture, opts);
}
