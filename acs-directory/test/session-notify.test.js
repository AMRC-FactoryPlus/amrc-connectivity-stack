/*
 * ACS Directory
 * Tests for the Last_Changed notices published for births and deaths
 * Copyright 2026 University of Sheffield
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Address } from "@amrc-factoryplus/service-client";

import MQTTCli from "../lib/mqttcli.js";
import { birth_changes } from "../lib/queries.js";

const DEV       = "4f1b7f0e-2a51-4d1c-9a43-5c0f3e1d2b6a";
const SCH_A     = "a1b2c3d4-0000-4000-8000-000000000001";
const SCH_B     = "a1b2c3d4-0000-4000-8000-000000000002";

/* Device 1 is born at address 10 */
const BIRTH = { devid: 1, addrid: 10 };

/* birth_changes is given the sessions the birth replaces, as they were
 * before the birth closed them. */

test("a rebirth of an online device at the same address changes nothing",
() => {
    assert.deepEqual(birth_changes(BIRTH,
        { address: 10, open: true }, { device: 1, open: true }),
        { device_changed: false, address_changed: false });
});

test("a first birth changes the device and the address", () => {
    assert.deepEqual(birth_changes(BIRTH, undefined, undefined),
        { device_changed: true, address_changed: true });
});

test("a birth after a death changes the device and the address", () => {
    /* The device was offline, so it has come back online */
    assert.deepEqual(birth_changes(BIRTH,
        { address: 10, open: false }, { device: 1, open: false }),
        { device_changed: true, address_changed: true });
});

test("a device that moved address changes both", () => {
    /* It was online at address 9; address 10 was unused */
    assert.deepEqual(birth_changes(BIRTH,
        { address: 9, open: true }, undefined),
        { device_changed: true, address_changed: true });
});

test("an address taken over by another device changes the address", () => {
    /* Our device stayed online at 10, but device 2 was last at 10 */
    assert.deepEqual(birth_changes(BIRTH,
        { address: 10, open: true }, { device: 2, open: true }),
        { device_changed: false, address_changed: true });
});

/* A bare object standing in for MQTTCli. on_session_notify and
 * announce_birth only touch these members. */
function mk_cli (session, schemas = {}) {
    const published = [];
    const cli = {
        log:    () => {},
        model:  {
            session_notification_info:  async () => session,
            session_schemas:            async id => schemas[id] ?? [],
            prune_device_sessions:      async () => 0,
        },
        publish_changed: changes => published.push(...changes),
        names:  () => published.map(([name, value]) => `${name}=${value}`),
    };
    return cli;
}

function mk_session (over = {}) {
    return {
        device:             DEV,
        devid:              1,
        group_id:           "Group",
        node_id:            "Node",
        device_id:          "Device",
        online:             true,
        next_for_device:    null,
        next_for_address:   null,
        prev_for_device:    100,
        ...over,
    };
}

const on_session_notify = MQTTCli.prototype.on_session_notify;
const announce_birth = MQTTCli.prototype.announce_birth;

test("the notification for a new session announces only schema changes",
async () => {
    /* on_birth announces the device and address if they changed */
    const cli = mk_cli(mk_session(), { 100: [SCH_A], 200: [SCH_B] });
    await on_session_notify.call(cli, 200);
    assert.deepEqual(cli.names().sort(), [
        `Schema_Usage=${SCH_A}`,
        `Schema_Usage=${SCH_B}`,
    ]);
});

test("the notification for an unchanged rebirth announces nothing",
async () => {
    const cli = mk_cli(mk_session(), { 100: [SCH_A], 200: [SCH_A] });
    await on_session_notify.call(cli, 200);
    assert.deepEqual(cli.names(), []);
});

test("a death is announced", async () => {
    const cli = mk_cli(mk_session({ online: false }),
        { 100: [SCH_A], 200: [SCH_A] });
    await on_session_notify.call(cli, 200);
    assert.deepEqual(cli.names(), [
        `Device_UUID=${DEV}`,
        "Device_Address=Group/Node/Device",
    ]);
});

test("a session that has been replaced announces nothing", async () => {
    const cli = mk_cli(mk_session({
        online:             false,
        next_for_device:    201,
        next_for_address:   201,
    }), { 100: [SCH_A], 200: [SCH_A] });
    await on_session_notify.call(cli, 200);
    assert.deepEqual(cli.names(), []);
});

test("announce_birth publishes what the birth changed", () => {
    const addr = new Address("Group", "Node", "Device");
    const go = born => {
        const cli = mk_cli();
        announce_birth.call(cli, addr, born);
        return cli.names();
    };

    assert.deepEqual(go({ uuid: DEV,
        device_changed: true, address_changed: true }),
        [`Device_UUID=${DEV}`, "Device_Address=Group/Node/Device"]);
    assert.deepEqual(go({ uuid: DEV,
        device_changed: false, address_changed: true }),
        ["Device_Address=Group/Node/Device"]);
    assert.deepEqual(go({ uuid: DEV,
        device_changed: false, address_changed: false }), []);
    assert.deepEqual(go(undefined), [], "nothing recorded");
});
