/*
 * ACS Edge Agent
 * Edge Scout end-to-end tests: an agent of another release, for a
 * real driver to talk to
 * Copyright 2026 University of Sheffield
 *
 * The real DriverBroker with the ACL of the agent being stood in for,
 * through its test-only `acl` option, and the driver handshake an
 * agent of that release makes: active, then conf and addr on every
 * READY, then polls. The addr packet carries `features` only when the
 * agent stood in for would send it. This is enough to show how a
 * driver of this release behaves against an older agent, which the
 * agent under test can't be made to be.
 */

import fs from "fs";
import os from "os";
import path from "path";

import { ACL, DriverBroker, driver_acl } from "../../../lib/driverBroker";

import { until } from "./processes";

const prefix = "fpEdge1";

/* The driver ACL before v6.8.0 (17cadd91, #726) added req and rsp. */
export function pre_680_acl (id: string): ACL {
    return {
        publish: new RegExp(`^${prefix}/${id}/(?:status|data/\\w+|err/\\w+)$`),
        subscribe: new RegExp(`^${prefix}/${id}/(?:active|conf|addr|cmd/#|poll)$`),
    };
}

/* The driver ACL of ACS 7 before scouting: today's without found and
 * scout. */
export function pre_scout_acl (id: string): ACL {
    return {
        publish: new RegExp(
            `^${prefix}/${id}/(?:status|data/\\w+|err/\\w+|req/\\w+|result/\\w+)$`),
        subscribe: new RegExp(
            `^${prefix}/${id}/(?:active|conf|addr|cmd/#|write/#|poll|rsp/\\w+)$`),
    };
}

export interface AgentKind {
    name:       string,
    acl:        (id: string) => ACL,
    features:   boolean,
}

export const PRE_680: AgentKind = { name: "pre-v6.8.0", acl: pre_680_acl, features: false };
export const PRE_SCOUT: AgentKind = { name: "ACS 7, before scouting,", acl: pre_scout_acl, features: false };
export const CURRENT: AgentKind = { name: "this release", acl: driver_acl, features: true };

export class StandInAgent {
    broker!:    DriverBroker
    passwords:  string
    statuses:   string[] = []
    data = 0
    connects = 0
    disconnects = 0
    subscribed: string[] = []
    found:      { data: string, payload: any }[] = []
    #poll?:     NodeJS.Timeout

    constructor (public kind: AgentKind, public port: number, public id: string,
        public conf: any, public addrs: string[]) {
        this.passwords = fs.mkdtempSync(path.join(os.tmpdir(), "scout-e2e-standin-"));
    }

    async start (password: string) {
        fs.writeFileSync(path.join(this.passwords, this.id), password);
        const b = this.broker = new DriverBroker(
            { EDGE_MQTT: `mqtt://127.0.0.1:${this.port}`, EDGE_PASSWORDS: this.passwords },
            { acl: this.kind.acl });
        b.broker.on("client", c => { if (c.id == this.id) this.connects++; });
        b.broker.on("clientDisconnect", c => { if (c.id == this.id) this.disconnects++; });
        b.broker.on("subscribe", (subs, c) => {
            if (c?.id == this.id) this.subscribed.push(...subs.map(s => s.topic));
        });
        b.on("message", m => this.#message(m));
        await b.start();
        await b.publish({ id: this.id, msg: "active", payload: Buffer.from("ONLINE") });
        this.#poll = setInterval(() => {
            if (this.statuses[this.statuses.length - 1] != "UP") return;
            b.publish({ id: this.id, msg: "poll",
                payload: Buffer.from(this.addrs.map((_, i) => `t${i}`).join("\n")) });
        }, 200);
        return this;
    }

    #message (m: { id: string, msg: string, data?: string, payload: Buffer }) {
        if (m.id != this.id) return;
        if (m.msg == "status") {
            const st = m.payload.toString();
            this.statuses.push(st);
            if (st == "READY") this.#handshake();
        }
        if (m.msg == "data") this.data++;
        if (m.msg == "found") this.found.push({ data: m.data!, payload: JSON.parse(m.payload.toString()) });
    }

    #handshake () {
        const b = this.broker;
        b.publish({ id: this.id, msg: "conf", payload: Buffer.from(JSON.stringify(this.conf)) });
        const addr: any = {
            version: 1,
            addrs: Object.fromEntries(this.addrs.map((a, i) => [`t${i}`, a])),
            groups: { Device: { poll: 200, addrs: this.addrs.map((_, i) => `t${i}`) } },
        };
        if (this.kind.features) addr.features = { scout: 1 };
        b.publish({ id: this.id, msg: "addr", payload: Buffer.from(JSON.stringify(addr)) });
    }

    /* Ask the driver for its scout answer, as this release's agent
     * does once the driver subscribes. */
    hello () {
        return this.broker.publish({ id: this.id, msg: "scout",
            payload: Buffer.from(JSON.stringify({ op: "hello", version: 1 })) });
    }

    async up (ms = 30_000) {
        await until(() => this.statuses[this.statuses.length - 1] == "UP",
            `${this.id} UP on the ${this.kind.name} agent (statuses ${this.statuses.join(",")})`, ms);
    }

    async stop () {
        clearInterval(this.#poll);
        await this.broker?.stop();
    }

    cleanup () {
        fs.rmSync(this.passwords, { recursive: true, force: true });
    }
}
