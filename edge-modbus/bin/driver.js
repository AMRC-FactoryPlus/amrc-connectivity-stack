/* AMRC Connectivity Stack
 * Modbus Edge Agent driver
 * Copyright 2024 AMRC
 */

import asyncjs from "async";
import MQTT from "mqtt";
import ModbusRTU from "modbus-serial";

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

let client;
async function setConf (conf) {
    if (conf.protocol != "tcp")
        return "CONF";

    client = new ModbusRTU();
    return client.connectTCP(conf.host, { port: conf.port })
        .then(() => "UP", () => "CONN");
}

let addrs;

const funcs = {
    input:      { 
        read:   (c, a, l) => c.readInputRegisters(a, l),
    },
    holding:    {
        read:   (c, a, l) => c.readHoldingRegisters(a, l),
    },
    coil:       {
        read:   (c, a, l) => c.readCoils(a, l),
    },
    discrete:   {
        read:   (c, a, l) => c.readDiscreteInputs(a, l),
    },
};

function parseAddr (spec) {
    const parts = spec.split(",");
    if (parts.length != 4) return;

    const id = Number.parseInt(parts[0]);
    if (Number.isNaN(id) || id < 0) return;
    const func = funcs[parts[1]];
    if (!func) return;
    const addr = Number.parseInt(parts[2]);
    if (Number.isNaN(addr) || addr < 0) return;
    const len = Number.parseInt(parts[3]);
    if (Number.isNaN(len) || len < 1) return;

    return { id, func, addr, len };
}

async function poll ({ data, addr }) {
    console.log("READ %O", addr);
    if (!client) {
        console.log("Can't poll, no client!");
        return;
    }
    if (!client.isOpen) {
        const st = await new Promise((r, j) => 
            client.open(e => {
                console.log("Modbus open: %s", e);
                r(e ? "CONN" : "UP");
            }));
        setStatus(st);
        if (status != "UP") return;
    }

    client.setID(addr.id);
    const val = await addr.func.read(client, addr.addr, addr.len);
    console.log("DATA %O", val);

    await mqtt.publishAsync(data, val.buffer);
}
const polling = asyncjs.queue(asyncjs.timeout(poll, 10000));
polling.error(e => console.log("POLL ERR: %o", e));

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
    
    addrs = new Map(parsed);
    console.log("Set addrs: %O", addrs);
    return true;
}

mqtt.on("connect", async () => {
    await mqtt.subscribeAsync(
        "active conf addr poll"
            .split(" ")
            .map(t => topic(t)));
    setStatus("READY");
});
mqtt.on("message", async (t, p) => {
    const [, , msg, data] = t.split("/");
    switch (msg) {
    case "active":
        if (p.toString() == "ONLINE")
            setStatus("READY");
        break;
    case "conf":
        const conf = JSON.parse(p.toString());
        console.log("CONF: %O", conf);
        setStatus(await setConf(conf));
        break;
    case "addr":
        const a = JSON.parse(p.toString());
        if (!setAddrs(a))
            setStatus("CONF");
        break;
    case "poll":
        const poll = p.toString().split("\n");
        console.log("POLL %s %O", polling.length(), poll);
        if (addrs)
            poll.map(t => ({
                    data: topic("data", t),
                    addr: addrs.get(t),
                }))
                .filter(({ addr }) => addr)
                .forEach(a => polling.push(a));
        else
            console.log("Can't poll, no addrs!");
        break;
    }
});

mqtt.connect();
