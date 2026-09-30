/*
 * ACS Monitor
 * Tests for the Edge Agent config reload logic in AgentMonitor.
 *
 * These drive a real AgentMonitor, a real SparkplugDevice and the real
 * ConfigDBWatcher from stubbed MQTT packet streams, a stubbed ConfigDB
 * and a stubbed CmdEsc. Nothing touches the network.
 */

import assert       from "node:assert/strict";
import { test }     from "node:test";
import { format }   from "node:util";

import * as imm     from "immutable";
import * as rx      from "rxjs";

import { Address }  from "@amrc-factoryplus/service-client";
import { ConfigDBWatcher }
    from "@amrc-factoryplus/service-client/lib/service/configdb-watcher.js";
import { SparkplugDevice }
    from "@amrc-factoryplus/sparkplug-app/lib/sparkplug-device.js";

import { AgentMonitor } from "../lib/monitor/agent.js";
import { App }          from "../lib/uuids.js";

const NODE      = "d0b02634-54e5-4ffa-a218-03e802ed6cad";
const AGENT     = "AMRC-Central/Bristol";
const CDB       = "AMRC-Service-Core/Config_DB";
const OTHER_APP = "cb40bed5-49ad-4443-a7f5-08c75009da8f";

const ETAG_OLD  = "5a1c3b8e-0f6d-4d0e-9d5c-1a2b3c4d5e6f";
const ETAG_NEW  = "94096212-a43a-41bb-88e1-cb04be5bde20";
const ETAG_NEW2 = "0c9e4f5a-7b6d-4c3e-8f1a-2b3c4d5e6f70";

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

/* A stub environment for one AgentMonitor. */
class Harness {
    constructor (opts = {}) {
        /* The ConfigDB's current revision of our EdgeAgentConfig */
        this.etag = opts.etag ?? ETAG_OLD;
        /* Does the ConfigDB answer rebirth requests? */
        this.cdb_rebirths = opts.cdb_rebirths ?? true;

        this.logs = [];
        this.reloads = [];
        this.heads = 0;
        /* If set, HEAD requests wait for this before answering */
        this.hold_heads = null;

        this.topics = new Map();

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
                get_config_etag: async (app, obj) => {
                    assert.equal(app, App.AgentConfig);
                    assert.equal(obj, NODE);
                    harness.heads++;
                    /* Read the revision when the request arrives at
                     * the server, as the real ConfigDB does. */
                    const etag = harness.etag;
                    if (harness.hold_heads) await harness.hold_heads;
                    return etag;
                },
            },
            CmdEsc: {
                rebirth: async addr => {
                    if (`${addr}` == CDB) {
                        if (harness.cdb_rebirths)
                            setTimeout(() => harness.cdb_birth(), 1);
                    }
                    else
                        setTimeout(() => harness.agent_birth(), 1);
                },
                request_cmd: async cmd => {
                    harness.reloads.push(cmd);
                    /* A real agent reloads, refetching its config,
                     * and rebirths */
                    setTimeout(() => harness.agent_reload(), 1);
                },
            },
        };
        this.fplus.MQTT = { sparkplug_app: async () => this.app };

        this.app = {
            fplus:          this.fplus,
            debug,
            watch_address:  addr => this.topic(`${addr}`),
            device:         opts => new SparkplugDevice(this.app, opts),
        };

        /* The agent's in-use revision */
        this.agent_rev = this.etag;
    }

    topic (addr) {
        if (!this.topics.has(addr))
            this.topics.set(addr, new rx.Subject());
        return this.topics.get(addr);
    }

    publish (addr, type, metrics) {
        this.topic(addr).next({
            address: Address.parse(addr),
            type, metrics,
            uuid: "11ad7b32-1d32-4c4a-b0c9-68b8aee22219",
        });
    }

    cdb_birth () {
        this.publish(CDB, "BIRTH", [
            { name: "Last_Changed/Application", value: "" },
        ]);
    }

    /* The ConfigDB has committed a change and published Last_Changed */
    cdb_changed (app) {
        this.publish(CDB, "DATA", [
            { name: "Last_Changed/Application", value: app },
        ]);
    }

    /* Change our EdgeAgentConfig and notify, as the ConfigDB does */
    change_config (etag) {
        this.etag = etag;
        this.cdb_changed(App.AgentConfig);
    }

    agent_birth () {
        this.publish(AGENT, "BIRTH", [
            { name: "Config_Revision", value: this.agent_rev },
        ]);
    }

    /* The agent restarts or reloads: it fetches the current config
     * and rebirths with the new revision. */
    agent_reload () {
        this.agent_rev = this.etag;
        this.agent_birth();
    }

    async start () {
        const cdb_dev = this.app.device({ address: CDB });
        const op = {
            fplus:      this.fplus,
            cdb_watch:  new ConfigDBWatcher(this.fplus.ConfigDB, cdb_dev),
            secrets:    rx.NEVER,
        };
        const spec = {
            uuid:       NODE,
            interval:   "3m",
            secrets:    imm.Set(),
        };

        this.monitor = await new AgentMonitor(op, spec).init();
        this.sub = this.monitor.checks().subscribe();
        await tick(50);
        return this;
    }

    stop () {
        this.sub?.unsubscribe();
    }

    config_logs () {
        return this.logs.filter(l => /Config changed/.test(l)).length;
    }
}

test("startup with matching revisions sends no reload", async t => {
    const h = await new Harness().start();
    t.after(() => h.stop());

    h.agent_birth();
    await tick();
    assert.equal(h.reloads.length, 0);
});

test("a genuine config change sends one reload", async t => {
    const h = await new Harness().start();
    t.after(() => h.stop());

    h.change_config(ETAG_NEW);
    await tick(100);
    assert.equal(h.reloads.length, 1, "one reload for the change");
    assert.equal(h.reloads[0].name, "Node Control/Reload Edge Agent Config");
    assert.equal(h.agent_rev, ETAG_NEW, "the agent has reloaded");

    /* Wait out the throttle window so a trailing emission would show */
    await tick(5500);
    assert.equal(h.reloads.length, 1, "no further reloads");
});

test("rapid changes with an abandoned slow HEAD converge", async t => {
    const h = await new Harness().start();
    t.after(() => h.stop());

    /* Two changes in quick succession while the ConfigDB is slow. The
     * first HEAD is abandoned by switchMap. */
    let release;
    h.hold_heads = new Promise(r => release = r);
    h.change_config(ETAG_NEW);
    await tick(5);
    h.change_config(ETAG_NEW2);
    await tick(5);
    h.hold_heads = null;
    release();
    await tick(100);

    assert.equal(h.reloads.length, 1, "one reload for the changes");
    assert.equal(h.agent_rev, ETAG_NEW2, "the agent has the latest config");

    /* Further births must not cause reloads */
    for (let i = 0; i < 3; i++) {
        h.agent_birth();
        await tick(50);
    }
    await tick(5500);
    assert.equal(h.reloads.length, 1, "no reloads once in sync");
});

test("other applications' changes do not cause reloads", async t => {
    const h = await new Harness().start();
    t.after(() => h.stop());

    h.cdb_changed(OTHER_APP);
    h.cdb_changed(App.AgentConfig);
    await tick(50);
    h.agent_birth();
    await tick(50);
    assert.equal(h.reloads.length, 0);
});
