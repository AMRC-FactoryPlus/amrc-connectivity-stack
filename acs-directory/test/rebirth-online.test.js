/*
 * ACS Directory
 * Tests for the online-device tracking used to suppress rebirths
 * Copyright 2026 University of Sheffield
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Address } from "@amrc-factoryplus/service-client";

import MQTTCli from "../lib/mqttcli.js";

/* do_we_rebirth only touches this.online and this.rebirths, so we can
 * exercise it against a bare object rather than building a whole
 * MQTTCli. */
function mk_cli (online) {
    return {
        online:     new Set(online),
        rebirths:   { pending: {}, sent: {} },
        log:        () => {},
    };
}

const do_we_rebirth = MQTTCli.prototype.do_we_rebirth;

test("a device we have seen born is not rebirthed", async () => {
    /* The Set is populated from on_birth, which keys by toString. The
     * address we are asked about is a different object with the same
     * value; keying on the object itself would compare by reference and
     * never match, so we would rebirth a device that is already online. */
    const cli = mk_cli(["Group/Node/Device"]);
    const addr = new Address("Group", "Node", "Device");

    assert.equal(await do_we_rebirth.call(cli, addr), false);
    assert.deepEqual(cli.rebirths.sent, {},
        "must not record a rebirth for an online device");
});

test("a node address we have seen born is not rebirthed", async () => {
    const cli = mk_cli(["Group/Node"]);
    const addr = new Address("Group", "Node");

    assert.equal(await do_we_rebirth.call(cli, addr), false);
});

test("a device we have not seen is rebirthed", async () => {
    const cli = mk_cli(["Group/Node/Other"]);
    const addr = new Address("Group", "Node", "Device");

    assert.equal(await do_we_rebirth.call(cli, addr), true);
    assert.ok("Group/Node/Device" in cli.rebirths.sent,
        "must record that we have rebirthed this device");
});

test("a device rebirthed recently is not rebirthed again", async () => {
    const cli = mk_cli([]);
    cli.rebirths.sent["Group/Node/Device"] = Date.now();
    const addr = new Address("Group", "Node", "Device");

    assert.equal(await do_we_rebirth.call(cli, addr), false);
});

test("Address does not have value semantics", () => {
    /* This is the property that makes the toString keys necessary. If
     * this ever stops being true the keying can be simplified, but
     * until then Sets and Maps must be keyed on the string. */
    const one = new Address("Group", "Node", "Device");
    const two = new Address("Group", "Node", "Device");

    assert.notEqual(one, two);
    assert.ok(one.equals(two));
    assert.equal(one.toString(), two.toString());
    assert.equal(new Set([one]).has(two), false);
});
