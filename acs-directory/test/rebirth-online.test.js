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

const on_data = MQTTCli.prototype.on_data;
const maybe_rebirth = MQTTCli.prototype.maybe_rebirth;

/* A client whose rebirth check takes as long as the real one, and
 * which records the rebirths it sends. */
function mk_slow_cli () {
    const sent = [];
    return {
        sent,
        rebirths:   { pending: {}, sent: {}, nodes: {} },
        log:        () => {},
        handle_alert_updates: () => {},
        do_we_rebirth: () => new Promise(r => setTimeout(() => r(true), 200)),
        maybe_rebirth,
        fplus: { CmdEsc: { rebirth: async node => sent.push(node.toString()) } },
    };
}

test("DATA from an unknown device does not hold up the queue", async () => {
    /* Messages are handled one at a time, so on_data must return
     * before the rebirth check's wait is over. */
    const cli = mk_slow_cli();
    const start = Date.now();
    await on_data.call(cli, new Address("Group", "Node", "Device"), {});

    assert.ok(Date.now() - start < 100,
        "on_data must not wait for the rebirth check");
    await new Promise(r => setTimeout(r, 300));
    assert.deepEqual(cli.sent, ["Group/Node"]);
});

test("unknown devices on one node send one node rebirth", async () => {
    const cli = mk_slow_cli();
    for (const dev of ["A", "B", "C"])
        await on_data.call(cli, new Address("Group", "Node", dev), {});
    await on_data.call(cli, new Address("Group", "Other", "D"), {});
    await new Promise(r => setTimeout(r, 300));

    assert.deepEqual(cli.sent.sort(), ["Group/Node", "Group/Other"]);
});

test("a failed rebirth is logged, not thrown", async () => {
    const cli = mk_slow_cli();
    const logged = [];
    cli.log = (...args) => logged.push(args);
    cli.fplus.CmdEsc.rebirth = async () => { throw new Error("cmdesc down"); };

    await on_data.call(cli, new Address("Group", "Node", "Device"), {});
    await new Promise(r => setTimeout(r, 300));

    assert.ok(logged.some(l => l[0] == "rebirth" && /failed/.test(l[1])));
});
