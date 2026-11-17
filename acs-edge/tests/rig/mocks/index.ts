/*
 * ACS Edge Agent
 * Split-driver cluster rig: make the mock for a rig connection
 * Copyright 2026 University of Sheffield
 */

import type { Fixture } from "../../fixtures/drivers/fixture.js";
import { synthesise } from "../../fixtures/drivers/synth.js";
import type { Rig, RigConnection } from "../rig.js";

import { HttpMock } from "./http.js";
import type { Mock } from "./mock.js";
import { MqttMock } from "./mqtt.js";
import { OpcuaMock } from "./opcua.js";
import { UdpMock } from "./udp.js";

export interface MockOpts {
    advertise?:     string,
    udp_target?:    string,
}

/* The synthetic fixture a connection's mock replays. Values follow the
 * same generator as the driver fixtures, so the metric types and
 * payload shapes match what the Edge Agent's parser expects. */
export function rig_fixture (rig: Rig, c: RigConnection): Fixture {
    return synthesise(c.connection, {
        agent:              c.node,
        seed:               rig.seed,
        duration_ms:        rig.duration_ms,
        mqtt_interval_ms:   rig.mqtt_interval_ms,
    }).fixture;
}

export function make_mock (rig: Rig, c: RigConnection, opts: MockOpts = {}): Mock {
    const fixture = rig_fixture(rig, c);
    switch (c.protocol) {
    case "OPC UA":  return new OpcuaMock(c, fixture, { advertise: opts.advertise });
    case "MQTT":    return new MqttMock(c, fixture);
    case "REST":    return new HttpMock(c, fixture);
    case "UDP":     return new UdpMock(c, fixture, { target: opts.udp_target });
    }
}
