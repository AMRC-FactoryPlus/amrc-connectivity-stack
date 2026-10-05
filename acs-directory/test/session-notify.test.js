/*
 * ACS Directory
 * Tests for the Last_Changed notices published for session changes
 * Copyright 2026 University of Sheffield
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import MQTTCli from "../lib/mqttcli.js";

const DEV       = "4f1b7f0e-2a51-4d1c-9a43-5c0f3e1d2b6a";
const SCH_A     = "a1b2c3d4-0000-4000-8000-000000000001";
const SCH_B     = "a1b2c3d4-0000-4000-8000-000000000002";

/* A session row as session_notification_info returns it. By default
 * this is a rebirth: an open session for device 1 at address 10,
 * replacing an earlier session for the same device at the same
 * address which was open until this one started. */
function mk_session (over = {}) {
    return {
        device:             DEV,
        devid:              1,
        addrid:             10,
        online:             true,
        group_id:           "Group",
        node_id:            "Node",
        device_id:          "Device",
        next_for_device:    null,
        next_for_address:   null,
        prev_for_device:    100,
        prev_device_addrid: 10,
        prev_address_devid: 1,
        prev_open:          true,
        prev_adr_open:      true,
        ...over,
    };
}

/* on_session_notify only touches this.model, this.log and
 * this.publish_changed, so we can run it against a bare object. */
async function notices (session, schemas = {}) {
    const published = [];
    const cli = {
        log:    () => {},
        model:  {
            session_notification_info:  async () => session,
            session_schemas:            async id => schemas[id] ?? [],
            prune_device_sessions:      async () => 0,
        },
        publish_changed: changes => published.push(...changes),
    };
    await MQTTCli.prototype.on_session_notify.call(cli, 200);
    return published.map(([name, value]) => `${name}=${value}`);
}

test("a rebirth with nothing changed publishes nothing", async () => {
    const got = await notices(mk_session(),
        { 100: [SCH_A], 200: [SCH_A] });
    assert.deepEqual(got, []);
});

test("a first birth announces the device and the address", async () => {
    const got = await notices(mk_session({
        prev_for_device:    null,
        prev_device_addrid: null,
        prev_address_devid: null,
        prev_open:          null,
        prev_adr_open:      null,
    }), { 200: [SCH_A] });
    assert.deepEqual(got, [
        `Device_UUID=${DEV}`,
        "Device_Address=Group/Node/Device",
        `Schema_Usage=${SCH_A}`,
    ]);
});

test("a device that moved address is announced", async () => {
    /* The device was at address 9; nothing was at address 10 */
    const got = await notices(mk_session({
        prev_device_addrid: 9,
        prev_address_devid: null,
    }));
    assert.deepEqual(got, [
        `Device_UUID=${DEV}`,
        "Device_Address=Group/Node/Device",
    ]);
});

test("an address taken over by another device is announced", async () => {
    /* Our device stayed at address 10, but this is a new session
     * for the address after another device (2) used it */
    const got = await notices(mk_session({ prev_address_devid: 2 }));
    assert.deepEqual(got, ["Device_Address=Group/Node/Device"]);
});

test("a rebirth with changed schemas announces only the schemas", async () => {
    const got = await notices(mk_session(),
        { 100: [SCH_A], 200: [SCH_B] });
    assert.deepEqual(got.sort(), [
        `Schema_Usage=${SCH_A}`,
        `Schema_Usage=${SCH_B}`,
    ]);
});

test("a death is still announced", async () => {
    /* The current session has been closed by a DEATH */
    const got = await notices(mk_session({ online: false }),
        { 100: [SCH_A], 200: [SCH_A] });
    assert.deepEqual(got, [
        `Device_UUID=${DEV}`,
        "Device_Address=Group/Node/Device",
    ]);
});

test("a session that has been replaced publishes nothing", async () => {
    /* The update setting next_for_* on the old session */
    const got = await notices(mk_session({
        online:             false,
        next_for_device:    201,
        next_for_address:   201,
    }), { 100: [SCH_A], 200: [SCH_A] });
    assert.deepEqual(got, []);
});

test("a birth after a death is announced", async () => {
    /* The previous session was closed by a DEATH before this BIRTH,
     * so the device has come back online */
    const got = await notices(mk_session({
        prev_open:      false,
        prev_adr_open:  false,
    }), { 100: [SCH_A], 200: [SCH_A] });
    assert.deepEqual(got, [
        `Device_UUID=${DEV}`,
        "Device_Address=Group/Node/Device",
    ]);
});
