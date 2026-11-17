/*
 * ACS Edge Agent benchmark
 * Stub split driver for rate.mjs: every value changes at a fixed rate
 * Copyright 2026 University of Sheffield
 *
 *   (forked by rate.mjs) rate-stub.mjs <url> <id> <password> <values> <hz>
 *
 * It gets the device UP, waits for an address map holding all its
 * addresses, then on each tick publishes one `{"value", "timestamp"}`
 * message per address, back to back, as edge-opcua does with the
 * values of one subscription notification.
 */

import mqtt from "mqtt";

const [url, id, password, values, hz] = process.argv.slice(2);
const N = Number(values);
const prefix = `fpEdge1/${id}`;

let topics = null;
let timer = null;
let tick = 0;

const client = mqtt.connect(url, {
    clientId: id, username: id, password,
    reconnectPeriod: 0,
});

client.on("error", e => {
    console.error("rate stub: %s", e.message);
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
        const by_addr = new Map(Object.entries(addrs).map(([t, a]) => [a, t]));
        const want = Array.from({ length: N }, (_, i) => by_addr.get(`v${i}`));
        if (!topics && want.every(t => t)) {
            topics = want.map(t => `${prefix}/data/${t}`);
            process.send({ ready: true });
        }
    }
});

function burst () {
    tick++;
    const ts = Date.now();
    for (let i = 0; i < N; i++)
        client.publish(topics[i],
            `{"value":${i + tick * 0.5},"timestamp":${ts}}`);
}

process.on("message", m => {
    if (m.start) {
        timer = setInterval(burst, 1000 / Number(hz));
    }
    else if (m.exit) {
        clearInterval(timer);
        client.end(true, () => process.exit(0));
    }
});
