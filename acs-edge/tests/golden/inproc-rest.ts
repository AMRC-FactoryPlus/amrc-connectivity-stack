/*
 * ACS Edge Agent
 * Golden-output harness: a minimal in-process REST driver
 * Copyright 2026 University of Sheffield
 *
 * Test support only. It speaks the driver protocol directly with
 * mqtt.js rather than through lib/js-edge-driver, which is an ES
 * module this jest run cannot load. It exists to exercise the
 * harness's in-process driver path, and shows the whole protocol a
 * polled split driver needs (docs/edge-split.md) in one page.
 */

import http from "http";

import * as mqtt from "mqtt";

import { DriverEnv, DriverSpec, in_process } from "./driver.js";

function get (url: string, headers: { [h: string]: string }): Promise<{ status: number, body: Buffer }> {
    return new Promise((resolve, reject) => {
        http.get(url, { headers }, res => {
            const chunks: Buffer[] = [];
            res.on("data", c => chunks.push(c));
            res.on("end", () => resolve({
                status: res.statusCode ?? 0, body: Buffer.concat(chunks),
            }));
            res.on("error", reject);
        }).on("error", reject);
    });
}

async function start (env: DriverEnv) {
    const id = env.EDGE_USERNAME;
    const topic = (msg: string, data?: string) =>
        `fpEdge1/${id}/${msg}` + (data ? `/${data}` : "");

    let conf: any;
    let addrs = new Map<string, string>();

    const client = mqtt.connect(env.EDGE_MQTT, {
        clientId: id, username: id, password: env.EDGE_PASSWORD,
        will: { topic: topic("status"), payload: Buffer.from("DOWN"), qos: 0, retain: false },
    });

    const poll = async (dt: string) => {
        const addr = addrs.get(dt);
        if (addr == undefined || !conf) return;
        const headers: { [h: string]: string } = { Accept: "*/*" };
        if (conf.authMethod == "Basic")
            headers.Authorization = "Basic " + Buffer.from(
                `${conf.username}:${conf.password}`).toString("base64");
        try {
            const res = await get(conf.baseURL + addr, headers);
            if (res.status == 200)
                client.publish(topic("data", dt), res.body);
        }
        catch { /* the built-in connection only logs */ }
    };

    client.on("message", (t, p) => {
        const msg = t.split("/")[2];
        switch (msg) {
        case "active":
            if (p.toString() == "ONLINE") client.publish(topic("status"), "READY");
            break;
        case "conf":
            conf = JSON.parse(p.toString());
            break;
        case "addr":
            addrs = new Map(Object.entries(JSON.parse(p.toString()).addrs));
            client.publish(topic("status"), "UP");
            break;
        case "poll":
            for (const dt of p.toString().split("\n")) poll(dt);
            break;
        }
    });

    await new Promise<void>((resolve, reject) => {
        client.once("connect", () => resolve());
        client.once("error", reject);
    });
    await client.subscribeAsync(["active", "conf", "addr", "poll"].map(m => topic(m)));
    client.publish(topic("status"), "READY");

    return {
        stop: () => new Promise<void>(r => client.end(true, {}, () => r())),
    };
}

export function inproc_rest (): DriverSpec {
    return in_process("in-process REST driver (mqtt.js)", start);
}
