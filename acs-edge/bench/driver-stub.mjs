/*
 * ACS Edge Agent benchmark
 * Stub split driver, run as a child process of run.mjs
 * Copyright 2026 University of Sheffield
 *
 * It speaks the driver side of the protocol in docs/edge-split.md
 * just far enough to get the device UP, then publishes the case's
 * payloads on its data topic whenever the parent asks. It runs in its
 * own process so its CPU time is not counted against the Edge Agent.
 */

import mqtt from "mqtt";

import { find_case, payloads } from "./cases.mjs";

const [url, id, password, case_name] = process.argv.slice(2);
const c = find_case(case_name);
const bodies = payloads(c);
const prefix = `fpEdge1/${id}`;

let topic = null;

const client = mqtt.connect(url, {
    clientId: id, username: id, password,
    reconnectPeriod: 0,
});

client.on("error", e => {
    console.error("stub driver: %s", e.message);
    process.exit(2);
});

client.on("connect", () => {
    client.subscribe([`${prefix}/conf`, `${prefix}/addr`, `${prefix}/poll`],
        err => {
            if (err) throw err;
            client.publish(`${prefix}/status`, "READY");
        });
});

client.on("message", (t, payload) => {
    const msg = t.slice(prefix.length + 1);
    if (msg == "conf") {
        client.publish(`${prefix}/status`, "UP");
    }
    else if (msg == "addr") {
        const { addrs } = JSON.parse(payload.toString());
        const found = Object.entries(addrs).find(([, a]) => a == c.addr);
        if (found && !topic) {
            topic = `${prefix}/data/${found[0]}`;
            process.send({ ready: true });
        }
    }
});

/* { send: n, from: k }: publish n payloads, starting at variant k. */
process.on("message", m => {
    if (m.exit) {
        client.end(true, () => process.exit(0));
        return;
    }
    for (let i = 0; i < m.send; i++)
        client.publish(topic, bodies[(m.from + i) % bodies.length]);
    process.send({ sent: m.send });
});
