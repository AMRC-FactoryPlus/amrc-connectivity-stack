/* AMRC Connectivity Stack
 * Modbus Edge Agent driver
 * Copyright 2024 AMRC
 */

import asyncjs from "async";
import MQTT from "mqtt";

const id = process.env.EDGE_USERNAME;

const topic = (msg, data) => `fpEdge1/${id}/${msg}` + (data ? `/${data}` : "");

const mqtt = MQTT.connect({
    url:            process.env.EDGE_MQTT,
    clientId:       id,
    username:       id,
    password:       process.env.EDGE_PASSWORD,
    will:           {
        topic:      topic("status"),
        payload:    "DOWN",
    },
    manualConnect:  true,
    resubscribe:    false,
});

let status = "DOWN";
function setStatus (st) {
    status = st;
    if (mqtt.connected)
        mqtt.publish(topic("status"), status);
}
let conf;
let addrs;

const funcs = {
    const:  (p, a) => t => a,
    sin:    (p, a) => t => a * Math.sin(2 * Math.PI * (t / p)),
    saw:    (p, a) => t => (a / p) * (t % p),
}

function parseAddr (addr) {
    const parts = addr.split(":");
    if (parts.length != 3) return;

    const func = funcs[parts[0]];
    if (!func) return;
    const period = Number.parseFloat(parts[1]);
    if (Number.isNaN(period)) return;
    const amplitude = Number.parseFloat(parts[2]);
    if (Number.isNaN(amplitude)) return;

    return func(period, amplitude);
}

function setAddrs (pkt) {
    if (pkt.version != 1) {
        console.log("Bad addr config version: %s", pkt.version);
        return false;
    }
    
    const parsed = Object.entries(pkt.addrs)
        .map(([t, a]) => [t, parseAddr(a)]);
    if (parsed.some(([, f]) => !f)) {
        console.log("BAD ADDRS: %O", pkt.addrs);
        return false;
    }
    
    addrs = new Map(
        parsed.map(([t, f]) => [t, { topic: t, func: f }]));
    console.log("Set addrs: %O", addrs);
    return true;
}

const polling = asyncjs.queue(async addr => {
    const val = addr.func(performance.now());
    const buf = Buffer.alloc(8);
    const top = topic("data", addr.topic);

    buf.writeDoubleBE(val);
    await mqtt.publishAsync(top, buf);
});

mqtt.on("connect", async () => {
    await mqtt.subscribeAsync(
        "active conf addr poll"
            .split(" ")
            .map(t => topic(t)));
    setStatus("READY");
});
mqtt.on("message", (t, p) => {
    const [, , msg, data] = t.split("/");
    switch (msg) {
    case "active":
        if (p.toString() == "ONLINE")
            setStatus("READY");
        break;
    case "conf":
        conf = JSON.parse(p.toString());
        console.log("CONF: %O", conf);
        setStatus("UP");
        break;
    case "addr":
        const a = JSON.parse(p.toString());
        if (!setAddrs(a))
            setStatus("CONF");
        break;
    case "poll":
        const poll = p.toString().split("\n");
        console.log("POLL %O", poll);
        if (addrs)
            poll.map(t => addrs.get(t))
                .filter(a => a)
                .forEach(a => polling.push(a));
        else
            console.log("Can't poll, no addrs!");
        break;
    }
});

mqtt.connect();
