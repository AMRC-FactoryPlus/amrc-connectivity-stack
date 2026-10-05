/*
 * ACS Monitor
 * Tests for the Node liveness logic in NodeMonitor.
 *
 * These drive a real NodeMonitor and a real SparkplugDevice from
 * stubbed MQTT packet streams and a stubbed CmdEsc. Nothing touches the
 * network. The interval is shortened to 100 ms so the tests run in a
 * few seconds; the monitor derives all its timings from it.
 */

import assert       from "node:assert/strict";
import { test }     from "node:test";
import { format }   from "node:util";
import { EventEmitter } from "node:events";

import * as rx      from "rxjs";

import { Address }  from "@amrc-factoryplus/service-client";
import { SparkplugDevice }
    from "@amrc-factoryplus/sparkplug-app/lib/sparkplug-device.js";

import { NodeMonitor, State }   from "../lib/monitor/node.js";

const NODE      = "d0b02634-54e5-4ffa-a218-03e802ed6cad";
const AGENT     = "AMRC-Central/Bristol";
const DEVICE    = `${AGENT}/Lamp-1`;
const INTERVAL  = 100;

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

/* A stub environment for one NodeMonitor. */
class Harness {
    constructor (opts = {}) {
        /* Does the Node answer rebirth requests? */
        this.answers = opts.answers ?? true;

        this.logs = [];
        this.rebirths = 0;
        this.topics = new Map();
        /* Our MQTT connection, for connect events */
        this.mqtt = new EventEmitter();

        const debug = {
            log: (ch, ...args) => this.logs.push(`${ch}: ${format(...args)}`),
        };
        debug.bound = ch => debug.log.bind(debug, ch);

        const harness = this;
        this.fplus = {
            debug,
            ConfigDB: {
                get_config: async () =>
                    ({ group_id: "AMRC-Central", node_id: "Bristol" }),
            },
            CmdEsc: {
                rebirth: async addr => {
                    assert.equal(`${addr}`, AGENT);
                    harness.rebirths++;
                    if (harness.answers)
                        setTimeout(() => harness.births(), 1);
                },
            },
        };
        this.fplus.MQTT = { sparkplug_app: async () => this.app };

        this.app = {
            fplus:          this.fplus,
            debug,
            mqtt:           this.mqtt,
            watch_address:  addr => this.topic(`${addr}`),
            device:         opts => new SparkplugDevice(this.app, opts),
        };
    }

    topic (addr) {
        if (!this.topics.has(addr))
            this.topics.set(addr, new rx.Subject());
        return this.topics.get(addr);
    }

    publish (addr, type, metrics = []) {
        const address = Address.parse(addr);
        /* Device packets arrive on the Node's wildcard subscription */
        const topic = address.isDevice() ? `${AGENT}/+` : addr;
        this.topic(topic).next({
            address, type, metrics,
            uuid: "11ad7b32-1d32-4c4a-b0c9-68b8aee22219",
        });
    }

    /* The Node births, as it does on connect or on a rebirth request */
    births () {
        this.publish(AGENT, "BIRTH");
        this.publish(DEVICE, "BIRTH");
    }

    async start () {
        const op = { fplus: this.fplus };
        const spec = { uuid: NODE, interval: `${INTERVAL}ms` };

        this.monitor = await new NodeMonitor(op, spec).init();
        this.sub = this.monitor.checks().subscribe();
        this.offline = [];
        this.offline_sub = this.monitor.offline
            .subscribe(o => this.offline.push(o));
        await tick();
        return this;
    }

    stop () {
        this.sub?.unsubscribe();
        this.offline_sub?.unsubscribe();
    }

    state () {
        return rx.firstValueFrom(this.monitor.state);
    }

    is_offline () {
        return this.offline.at(-1);
    }
}

test("a Node that has birthed and stays silent is not rebirthed", async t => {
    const h = await new Harness().start();
    t.after(() => h.stop());

    h.births();
    await tick(15 * INTERVAL);

    assert.equal(await h.state(), State.Alive);
    assert.equal(h.rebirths, 0, "no rebirths for a quiet live Node");
    assert.equal(h.is_offline(), false, "no Offline alert");
});

test("a silent Node at startup gets one rebirth, then none", async t => {
    const h = await new Harness().start();
    t.after(() => h.stop());

    assert.equal(await h.state(), State.Unknown);
    await tick(15 * INTERVAL);

    assert.equal(h.rebirths, 1, "one rebirth to find the Node");
    assert.equal(await h.state(), State.Alive);
    assert.equal(h.is_offline(), false, "no Offline alert");
});

test("a Node that never answers is rebirthed with backoff and goes Offline",
async t => {
    const h = await new Harness({ answers: false }).start();
    t.after(() => h.stop());

    await tick(2.5 * INTERVAL);
    assert.equal(h.is_offline(), false, "no alert before 3 intervals");

    await tick(20 * INTERVAL);
    /* Delays of 1, 2, 4, 8, 8 intervals plus jitter: rebirths at about
     * 1, 3, 7 and 15 intervals. The old check sent one every 1 to 1.25
     * intervals, about 18 in this time. */
    assert.ok(h.rebirths >= 3 && h.rebirths <= 5,
        `rebirths backed off (sent ${h.rebirths})`);
    assert.equal(h.is_offline(), true, "Offline alert raised");
});

test("an NDEATH raises Offline and a new birth clears it", async t => {
    const h = await new Harness({ answers: false }).start();
    t.after(() => h.stop());

    h.births();
    await tick();
    assert.equal(await h.state(), State.Alive);

    h.publish(AGENT, "DEATH");
    await tick();
    assert.equal(await h.state(), State.Dead);
    assert.equal(h.is_offline(), false, "no alert straight away");

    await tick(4 * INTERVAL);
    assert.equal(h.is_offline(), true, "Offline after 3 intervals");
    assert.ok(h.rebirths >= 1, "rebirth sent in case the Will was late");

    h.births();
    await tick();
    assert.equal(await h.state(), State.Alive);
    assert.equal(h.is_offline(), false, "alert cleared by the birth");

    const sent = h.rebirths;
    await tick(15 * INTERVAL);
    assert.equal(h.rebirths, sent, "no rebirths once Alive again");
});

test("a late Will is corrected by the rebirth reply", async t => {
    const h = await new Harness().start();
    t.after(() => h.stop());

    /* The Node reconnected and birthed before the broker sent the Will
     * for its old session. */
    h.births();
    h.publish(AGENT, "DEATH");
    await tick();
    assert.equal(await h.state(), State.Dead);

    await tick(3 * INTERVAL);
    assert.equal(h.rebirths, 1);
    assert.equal(await h.state(), State.Alive);
    assert.equal(h.is_offline(), false, "no Offline alert");
});

test("Device packets show the Node is up", async t => {
    const h = await new Harness().start();
    t.after(() => h.stop());

    /* We missed the NBIRTH but see a Device death */
    h.publish(DEVICE, "DEATH");
    await tick();
    assert.equal(await h.state(), State.Alive,
        "a DDEATH is not an NDEATH");

    await tick(15 * INTERVAL);
    assert.equal(h.rebirths, 0);
});

test("our own MQTT reconnect causes one rebirth", async t => {
    const h = await new Harness().start();
    t.after(() => h.stop());

    h.births();
    await tick();
    h.mqtt.emit("connect");
    await tick();
    assert.equal(await h.state(), State.Unknown,
        "we may have missed packets");

    await tick(15 * INTERVAL);
    assert.equal(h.rebirths, 1);
    assert.equal(await h.state(), State.Alive);
    assert.equal(h.is_offline(), false);
});
