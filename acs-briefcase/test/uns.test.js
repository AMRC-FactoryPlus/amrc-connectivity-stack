/*
 * ACS Briefcase exporter
 * Tests for publishing the release state of datasets to the UNS
 * Copyright 2026 University of Sheffield
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import * as imm from "immutable";
import * as rx  from "rxjs";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { App, Class, Schema } from "../lib/constants.js";
import {
    UNSPublisher, enterprise_of, release_messages, release_state,
} from "../lib/uns.js";

const A = "a0000000-0000-4000-8000-000000000000";
const B = "b0000000-0000-4000-8000-000000000000";
const D1 = "d1000000-0000-4000-8000-000000000000";
const D2 = "d2000000-0000-4000-8000-000000000000";
const D3 = "d3000000-0000-4000-8000-000000000000";

const OLD = "0b5e3a52-7f41-4c2e-a8d6-6a9f3e2d1c40";
const NEW = "1c6f4b63-8052-4d3f-b9e7-7b0f4e3e2d51";
const NOW = "2026-11-02T10:00:00.000Z";

const briefcase = { uuid: OLD, file: OLD, sha256: "a".repeat(64), size: 1,
    built: "2026-10-29T12:00:00.000Z", tier: "registered", exporter: "test" };
const live = { briefcases: [briefcase] };
const gone = { briefcases: [{ ...briefcase, withdrawn: "2026-10-29T13:00:00.000Z" }] };
/* A briefcase recorded before the exporter recorded tiers. */
const untiered = { ...briefcase };
delete untiered.tier;

const device_info = enterprise => ({ originMap: { Device_Information: {
    ISA95_Hierarchy: { Enterprise: { Value: enterprise } } } } });

test("a dataset with no briefcase is unreleased", () => {
    assert.deepEqual(release_state(undefined), { state: "unreleased" });
    assert.deepEqual(release_state({ briefcases: [] }), { state: "unreleased" });
});

test("a live briefcase is released from when it was built", () => {
    assert.deepEqual(release_state(live), {
        state: "released", at: briefcase.built,
        briefcase: OLD, built: briefcase.built, tier: "registered",
    });
});

test("a withdrawn briefcase is withdrawn from when it was withdrawn", () => {
    assert.deepEqual(release_state(gone), {
        state: "withdrawn", at: "2026-10-29T13:00:00.000Z",
        briefcase: OLD, built: briefcase.built, tier: "registered",
    });
});

test("the state comes from the newest briefcase", () => {
    const again = { briefcases: [
        gone.briefcases[0],
        { ...briefcase, uuid: NEW, replaces: OLD,
            built: "2026-10-30T09:00:00.000Z", tier: "open" },
    ] };
    assert.deepEqual(release_state(again), {
        state: "released", at: "2026-10-30T09:00:00.000Z",
        briefcase: NEW, built: "2026-10-30T09:00:00.000Z", tier: "open",
    });
});

test("a briefcase recorded without a tier has none", () => {
    assert.equal(release_state({ briefcases: [untiered] }).tier, undefined);
});

test("reads the enterprise from a device's ISA-95 hierarchy", () => {
    assert.equal(enterprise_of(device_info("National Grid")), "National Grid");
});

test("ignores an enterprise that can't be one topic level", () => {
    for (const name of ["", "A/B", "A+", "#", 42])
        assert.equal(enterprise_of(device_info(name)), null, `${name}`);
    assert.equal(enterprise_of(undefined), null);
    assert.equal(enterprise_of({ originMap: {} }), null);
});

const props = {
    InstanceUUID:       A,
    SchemaUUID:         Schema.DatasetRelease,
    Type:               "String",
    Unit:               "",
    Transient:          "false",
    InstanceUUIDPath:   `${A}:${A}`,
    SchemaUUIDPath:     `${Schema.DatasetRelease}:${Schema.DatasetRelease}`,
};

test("publishes an unreleased dataset's state at the time given", () => {
    const msgs = release_messages({
        enterprise: "AMRC", dataset: A, state: { state: "unreleased" }, now: NOW,
    });
    assert.deepEqual(msgs, [{
        topic:      `UNS/v1/AMRC/Datasets/${A}/Release/State`,
        payload:    JSON.stringify({ timestamp: NOW, value: "unreleased" }),
        properties: props,
    }]);
});

test("publishes a released dataset's state, briefcase and tier", () => {
    const msgs = release_messages({
        enterprise: "AMRC", dataset: A, state: release_state(gone), now: NOW,
    });
    const prefix = `UNS/v1/AMRC/Datasets/${A}/Release`;
    assert.deepEqual(msgs.map(m => [m.topic, JSON.parse(m.payload)]), [
        [`${prefix}/State`,
            { timestamp: "2026-10-29T13:00:00.000Z", value: "withdrawn" }],
        [`${prefix}/Briefcase`, { timestamp: briefcase.built, value: OLD }],
        [`${prefix}/Tier`, { timestamp: briefcase.built, value: "registered" }],
    ]);
    for (const m of msgs) assert.deepEqual(m.properties, props);
});

test("leaves out the tier of a briefcase recorded without one", () => {
    const msgs = release_messages({ enterprise: "AMRC", dataset: A,
        state: release_state({ briefcases: [untiered] }), now: NOW });
    assert.deepEqual(msgs.map(m => m.topic.split("/").at(-1)),
        ["State", "Briefcase"]);
});

test("emits states only when one changes", () => {
    const datasets = new rx.Subject();
    const releases = new rx.Subject();
    const fplus = {
        debug: { bound: () => () => {} },
        ConfigDB: {
            watch_members: klass => {
                assert.equal(klass, Class.Dataset);
                return datasets;
            },
            search_app: app => {
                assert.equal(app, App.BriefcaseRelease);
                return releases;
            },
        },
    };
    const seen = [];
    new UNSPublisher({ fplus }).watch_states()
        .subscribe(s => seen.push(Object.fromEntries(
            [...s].map(([ds, st]) => [ds, st.state]))));

    datasets.next(imm.Set([A]));
    assert.equal(seen.length, 0, "waits for the release entries");

    releases.next(imm.Map());
    /* A release entry of a dataset that has gone changes nothing. */
    releases.next(imm.Map({ [B]: live }));
    datasets.next(imm.Set([A, B]));
    releases.next(imm.Map({ [A]: live, [B]: live }));

    assert.deepEqual(seen, [
        { [A]: "unreleased" },
        { [A]: "unreleased", [B]: "released" },
        { [A]: "released", [B]: "released" },
    ]);
});

/* A UNSPublisher with fake ConfigDB, Data Access and MQTT. `devices`
 * maps each dataset to its devices, or to an error status. */
function make_publisher ({ devices = {}, infos = {} } = {}) {
    const sent = [];
    const scheduled = [];
    const calls = { series: [], infos: [] };
    let refuse = false;

    const fplus = {
        debug: { bound: () => () => {} },
        ConfigDB: {
            get_config: async (app, obj) => {
                assert.equal(app, UUIDs.App.DeviceInformation);
                calls.infos.push(obj);
                return infos[obj];
            },
        },
        DataAccess: {
            series: async body => {
                calls.series.push(body);
                const ds = devices[body.dataset] ?? [];
                if (typeof ds == "number")
                    throw Object.assign(new Error(`status ${ds}`), { status: ds });
                return { devices: Object.fromEntries(ds.map(d => [d, {}])) };
            },
        },
    };
    const mqtt = {
        publishAsync: async (topic, payload, opts) => {
            if (refuse) throw new Error("Publish error: Not authorized");
            sent.push({ topic, value: JSON.parse(payload).value, opts });
        },
    };
    const publisher = new UNSPublisher({
        fplus, mqtt,
        enterprise: "AMRC",
        retry:      300_000,
        now:        () => Date.parse(NOW),
        schedule:   (fn, ms) => scheduled.push(ms),
    });

    return {
        publisher, sent, scheduled, calls,
        refuse: r => { refuse = r; },
        /* The topics sent, without the shared prefix, and then forgotten. */
        take: () => sent.splice(0).map(m =>
            `${m.topic.replace(/^UNS\/v1\//, "")}=${m.value}`),
    };
}

const states = obj => new Map(Object.entries(obj)
    .map(([ds, entry]) => [ds, release_state(entry)]));

test("publishes every dataset when it starts, at QoS 1, not retained", async () => {
    const { publisher, sent, take } = make_publisher({
        devices: { [A]: [D1], [B]: [D2] },
        infos: { [D1]: device_info("AMRC"), [D2]: device_info("National Grid") },
    });
    publisher.update(states({ [A]: undefined, [B]: live }));
    await publisher.pass();

    for (const m of sent) {
        assert.deepEqual(m.opts.qos, 1);
        assert.deepEqual(m.opts.retain, false);
        assert.equal(m.opts.properties.userProperties.InstanceUUID,
            m.topic.split("/")[4]);
    }
    assert.deepEqual(take(), [
        `AMRC/Datasets/${A}/Release/State=unreleased`,
        `National Grid/Datasets/${B}/Release/State=released`,
        `National Grid/Datasets/${B}/Release/Briefcase=${OLD}`,
        `National Grid/Datasets/${B}/Release/Tier=registered`,
    ]);
});

test("asks Data Access for a dataset's devices over a window", async () => {
    const { publisher, calls } = make_publisher();
    publisher.update(states({ [A]: undefined }));
    await publisher.pass();

    assert.deepEqual(calls.series, [{
        dataset: A, from: "2026-11-02T09:00:00.000Z", to: NOW,
    }]);
});

test("publishes under every enterprise of a dataset's devices", async () => {
    const { publisher, take } = make_publisher({
        devices: { [A]: [D1, D2, D3] },
        infos: {
            [D1]: device_info("National Grid"),
            [D2]: device_info("AMRC"),
            [D3]: device_info("AMRC"),
        },
    });
    publisher.update(states({ [A]: undefined }));
    await publisher.pass();

    assert.deepEqual(take(), [
        `AMRC/Datasets/${A}/Release/State=unreleased`,
        `National Grid/Datasets/${A}/Release/State=unreleased`,
    ]);
});

test("falls back when no device has an enterprise", async () => {
    const { publisher, take } = make_publisher({
        devices: { [A]: [D1], [B]: 404 },
        infos: { [D1]: device_info("") },
    });
    publisher.update(states({ [A]: undefined, [B]: undefined }));
    await publisher.pass();

    assert.deepEqual(take(), [
        `AMRC/Datasets/${A}/Release/State=unreleased`,
        `AMRC/Datasets/${B}/Release/State=unreleased`,
    ]);
});

test("reads each device's Device Information once a pass", async () => {
    const { publisher, calls } = make_publisher({
        devices: { [A]: [D1], [B]: [D1] },
        infos: { [D1]: device_info("AMRC") },
    });
    publisher.update(states({ [A]: undefined, [B]: undefined }));
    await publisher.pass();

    assert.deepEqual(calls.infos, [D1]);
});

test("publishes again only the datasets that changed", async () => {
    const { publisher, take } = make_publisher();
    publisher.update(states({ [A]: undefined, [B]: live }));
    await publisher.pass();
    take();

    publisher.update(states({ [A]: live, [B]: live }));
    await publisher.pass();
    assert.deepEqual(take(), [
        `AMRC/Datasets/${A}/Release/State=released`,
        `AMRC/Datasets/${A}/Release/Briefcase=${OLD}`,
        `AMRC/Datasets/${A}/Release/Tier=registered`,
    ]);

    await publisher.pass();
    assert.deepEqual(take(), [], "nothing changed");
});

test("publishes a deleted dataset under the enterprises it was under", async () => {
    const { publisher, calls, take } = make_publisher({
        devices: { [A]: [D1, D2] },
        infos: { [D1]: device_info("AMRC"), [D2]: device_info("National Grid") },
    });
    publisher.update(states({ [A]: gone, [B]: undefined }));
    await publisher.pass();
    take();
    calls.series.length = 0;

    publisher.update(states({ [B]: undefined }));
    await publisher.pass();
    assert.deepEqual(take(), [
        `AMRC/Datasets/${A}/Release/State=deleted`,
        `National Grid/Datasets/${A}/Release/State=deleted`,
    ]);
    assert.deepEqual(calls.series, [], "a deleted dataset can't be resolved");

    await publisher.pass();
    assert.deepEqual(take(), [], "deleted only once");
});

test("retries a dataset that couldn't be published", async () => {
    const { publisher, scheduled, refuse, take } = make_publisher();
    publisher.update(states({ [A]: undefined }));
    refuse(true);
    await publisher.pass();
    assert.deepEqual(scheduled, [300_000]);

    refuse(false);
    await publisher.pass();
    assert.deepEqual(take(), [`AMRC/Datasets/${A}/Release/State=unreleased`]);
});

test("retries when Data Access can't list a dataset's devices", async () => {
    const { publisher, scheduled, take } = make_publisher({
        devices: { [A]: 503 },
    });
    publisher.update(states({ [A]: undefined }));
    await publisher.pass();
    assert.deepEqual(take(), [], "doesn't fall back on a server error");
    assert.deepEqual(scheduled, [300_000]);
});
