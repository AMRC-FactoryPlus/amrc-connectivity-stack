/*
 * ACS Edge Agent
 * Golden-output harness: an OPC UA server holding recorded node values
 * Copyright 2026 University of Sheffield
 */

import fs from "fs";
import os from "os";
import path from "path";

import {
    DataType, OPCUACertificateManager, OPCUAServer, resolveNodeId,
    SecurityPolicy, MessageSecurityMode, UAVariable, Variant,
} from "node-opcua";

import type { Fixture, OpcuaEvent, OpcuaValue } from "../../fixtures/drivers/fixture.js";
import { DeviceOpts, FakeDevice, free_port, sleep } from "./device.js";

/* How many times per fixture interval the connection samples. The
 * built-in connection samples each node at its poll interval, and a
 * node that changes at the same rate as it is sampled can have a
 * change missed or seen twice depending on timer phase, which would
 * make two runs differ for no reason. Sampling faster than the values
 * change makes every change seen exactly once. */
const OVERSAMPLE = 4;

function variant (v: OpcuaValue) {
    const dataType = (DataType as any)[v.dataType];
    if (dataType == undefined)
        throw new Error(`Unknown OPC UA data type ${v.dataType}`);
    const value = v.dataType == "DateTime" ? new Date(v.value) : v.value;
    return new Variant({ dataType, value });
}

/* A node-opcua server with one variable per node in the fixture. The
 * first event sets every node before the connection subscribes, so the
 * subscription's first notification is the starting values. Once the
 * connection has a subscription the later events are applied at their
 * times, scaled by the speed.
 *
 * Security is turned off: the connection is rewritten to
 * SecurityMode None, no credentials, on both runs. The fixtures record
 * which policies a connection uses, but no fixture can run a
 * certificate handshake, so a driver must be checked against a real
 * server for that (see the fixtures README). */
export class OpcuaDevice implements FakeDevice {
    fixture:    Fixture
    opts:       DeviceOpts
    events:     OpcuaEvent[]
    server?:    OPCUAServer
    pki:        string
    port = 0
    vars:       Map<string, UAVariable> = new Map()
    delivered = 0
    t0?:        number
    #replay?:   Promise<void>
    #stopped = false

    constructor (fixture: Fixture, opts: DeviceOpts) {
        this.fixture = fixture;
        this.opts = opts;
        this.events = fixture.events
            .filter((e): e is OpcuaEvent => e.type == "opcua")
            .sort((a, b) => a.t - b.t);
        this.pki = fs.mkdtempSync(path.join(os.tmpdir(), "golden-opcua-"));
    }

    /* node-opcua needs a port number before it listens, so take a free
     * one and try again if something else took it first. */
    async start () {
        for (let i = 1; ; i++) {
            try {
                await this.listen();
                break;
            }
            catch (e: any) {
                await this.server?.shutdown(0).catch(() => {});
                this.server = undefined;
                this.vars.clear();
                if (i >= 3 || !/EADDRINUSE/.test(String(e?.message ?? e))) throw e;
            }
        }
        this.#replay = this.replay();
    }

    async listen () {
        this.port = await free_port();
        const certs = new OPCUACertificateManager({
            rootFolder: path.join(this.pki, "server"),
            automaticallyAcceptUnknownCertificate: true,
        });
        const server = this.server = new OPCUAServer({
            port:                   this.port,
            hostname:               "127.0.0.1",
            securityModes:          [MessageSecurityMode.None],
            securityPolicies:       [SecurityPolicy.None],
            allowAnonymous:         true,
            serverCertificateManager: certs,
        });
        await server.initialize();

        const space = server.engine.addressSpace!;
        const first = this.events[0]?.values ?? {};
        for (const [id, v] of Object.entries(first)) {
            const node = resolveNodeId(id);
            while (space.getNamespaceArray().length <= node.namespace)
                space.registerNamespace(`urn:golden:ns${space.getNamespaceArray().length}`);
            const ns = space.getNamespace(node.namespace);
            const uav = ns.addVariable({
                organizedBy:    space.rootFolder.objects,
                browseName:     id,
                nodeId:         id,
                dataType:       v.dataType,
                minimumSamplingInterval: 0,
            });
            uav.setValueFromSource(variant(v));
            this.vars.set(id, uav);
        }

        await server.start();
    }

    connection (conn: any) {
        return {
            ...conn,
            /* reHashConf gives every device the connection's interval. */
            pollInt: Math.max(1, Math.round(conn.pollInt / OVERSAMPLE)),
            OPCUAConnDetails: {
                ...conn.OPCUAConnDetails,
                endpoint:       `opc.tcp://127.0.0.1:${this.port}`,
                securityMode:   "None",
                securityPolicy: "None",
                useCredentials: false,
                username:       "",
                password:       "",
            },
        };
    }

    apply (ev: OpcuaEvent) {
        for (const [id, v] of Object.entries(ev.values))
            this.vars.get(id)?.setValueFromSource(variant(v));
        this.delivered++;
    }

    async replay () {
        while (!this.#stopped && (this.server?.currentSubscriptionCount ?? 0) == 0)
            await sleep(10);
        /* Let the monitored items be created and the starting values
         * reported. */
        const interval = this.fixture.meta.interval_ms / this.opts.speed;
        await sleep(Math.max(300, interval));
        if (this.#stopped) return;

        const start = Date.now();
        const base = this.events[0]?.t ?? 0;
        this.t0 = start;
        this.delivered++;
        for (const ev of this.events.slice(1)) {
            if (this.#stopped) return;
            const wait = start + (ev.t - base) / this.opts.speed - Date.now();
            if (wait > 0) await sleep(wait);
            this.apply(ev);
        }
    }

    async finished () {
        await this.#replay;
        await sleep(Math.max(300, 2 * this.fixture.meta.interval_ms / this.opts.speed));
    }

    async stop () {
        this.#stopped = true;
        await this.server?.shutdown(0);
        this.server = undefined;
        fs.rmSync(this.pki, { recursive: true, force: true });
    }
}
