/*
 * ACS Edge Agent driver library
 * Edge Scout: a driver reconnecting to an older agent's broker.
 * Copyright 2026 University of Sheffield
 *
 * This runs a real driver against mosquitto in Docker. It first sees
 * the scout feature from a broker with today's ACL, then the broker is
 * replaced by one with the ACL from before v6.8.0, as after an agent
 * rollback, and the agent's addr has no features key. The driver must
 * not ask for the scout topic again, so it is never refused or
 * disconnected.
 *
 * The agent's own broker drops a driver that subscribes outside its
 * ACL. Mosquitto 2 instead grants the subscription and filters what it
 * delivers, so the test reads mosquitto's log to see every topic the
 * driver asked for.
 *
 * It needs Docker. Without it the test is skipped, unless
 * SCOUT_MOSQUITTO=1 is set, as CI does, and then it fails.
 */

import test from "node:test";
import assert from "node:assert/strict";
import child_process from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import timers from "node:timers/promises";

import MQTT from "mqtt";

import { Driver } from "../lib/driver.js";

const IMAGE = process.env.MOSQUITTO_IMAGE ?? "eclipse-mosquitto:2.0.20";
const REQUIRED = process.env.SCOUT_MOSQUITTO == "1";

/* The driver's ACL from before v6.8.0, and today's, which adds the
 * request, typed write and scout topics. The agent may do anything. */
const OLD_ACL = `
pattern read fpEdge1/%u/active
pattern read fpEdge1/%u/conf
pattern read fpEdge1/%u/addr
pattern read fpEdge1/%u/cmd/#
pattern read fpEdge1/%u/poll
pattern write fpEdge1/%u/status
pattern write fpEdge1/%u/data/+
pattern write fpEdge1/%u/err/+

user agent
topic readwrite #
`;
const NEW_ACL = `
pattern read fpEdge1/%u/write/#
pattern read fpEdge1/%u/rsp/+
pattern read fpEdge1/%u/scout
pattern write fpEdge1/%u/req/+
pattern write fpEdge1/%u/result/+
pattern write fpEdge1/%u/found/+
${OLD_ACL}`;

function docker (...args) {
    return child_process.execFileSync("docker", args,
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
}

function have_docker () {
    try {
        docker("info", "--format", "{{.ServerVersion}}");
        return true;
    }
    catch (e) {
        return false;
    }
}

function free_port () {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.on("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

async function wait_for (what, check, ms = 10000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        if (await check()) return;
        await timers.setTimeout(50);
    }
    assert.fail(`Timed out waiting for ${what}`);
}

/* Start mosquitto with an ACL on a fixed port. Returns its name. */
async function start_broker (port, acl) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scout-mosq-"));
    fs.writeFileSync(path.join(dir, "acl"), acl, { mode: 0o644 });
    fs.writeFileSync(path.join(dir, "mosquitto.conf"), [
        "listener 1883",
        "allow_anonymous true",
        "acl_file /mosquitto/config/acl",
        "persistence false",
        "log_dest stdout",
        "log_type all",
    ].join("\n") + "\n");
    fs.chmodSync(dir, 0o755);

    const name = `scout-js-${process.pid}-${port}-${Date.now()}`;
    docker("run", "-d", "--name", name, "-p", `127.0.0.1:${port}:1883`,
        "-v", `${dir}:/mosquitto/config:ro`, IMAGE);

    await wait_for("mosquitto to listen", () => new Promise(resolve => {
        const sock = net.connect(port, "127.0.0.1");
        sock.on("connect", () => { sock.destroy(); resolve(true); });
        sock.on("error", () => resolve(false));
    }));
    return name;
}

function broker_log (name) {
    try {
        return docker("logs", name);
    }
    catch (e) {
        return "";
    }
}

function stop_broker (name) {
    try {
        docker("rm", "-f", name);
    }
    catch (e) {
        /* Already gone. */
    }
}

/* The SUBSCRIBE requests mosquitto logged from one client. */
function subscriptions (log, client) {
    const subs = [];
    let inside = false;
    for (const line of log.split("\n")) {
        if (line.endsWith(`Received SUBSCRIBE from ${client}`))
            inside = true;
        else if (line.endsWith(`Sending SUBACK to ${client}`))
            inside = false;
        else if (inside) {
            const topic = /^\d+: \t(.*) \(QoS \d\)$/.exec(line);
            if (topic) subs.push(topic[1]);
        }
    }
    return subs;
}

const docker_ok = have_docker();

test("a driver that saw the feature never subscribes on an old-ACL broker",
    { skip: !docker_ok && !REQUIRED && "Docker is not available" },
    async t => {
        assert.ok(docker_ok, "SCOUT_MOSQUITTO=1 is set but Docker is not available");

        const port = await free_port();
        const url = `mqtt://127.0.0.1:${port}`;
        const brokers = [];
        t.after(() => brokers.forEach(stop_broker));

        brokers.push(await start_broker(port, NEW_ACL));

        /* A stand-in Edge Agent. It answers READY with conf and addr,
         * with the features key only while `features` is set. */
        let features = { scout: 1 };
        const agent = MQTT.connect(url, {
            clientId: "agent", username: "agent", reconnectPeriod: 200,
        });
        t.after(() => agent.end(true));
        const hellos = [];
        agent.on("message", (topic, payload) => {
            if (topic == "fpEdge1/Conn/status" && payload.toString() == "READY") {
                agent.publish("fpEdge1/Conn/conf", "{}");
                agent.publish("fpEdge1/Conn/addr", JSON.stringify({
                    version: 1, addrs: {}, groups: {},
                    ...(features ? { features } : {}),
                }));
            }
            if (topic == "fpEdge1/Conn/found/hello")
                hellos.push(JSON.parse(payload.toString()));
        });
        await agent.subscribeAsync(["fpEdge1/Conn/status", "fpEdge1/Conn/found/#"]);

        class Handler {
            static scouts = true;
            static create () { return new Handler(); }
            async connect () { return "UP"; }
            async scout () { return { exhaustive: true }; }
        }
        const driver = new Driver({
            handler: Handler,
            env: { EDGE_USERNAME: "Conn", EDGE_MQTT: url, EDGE_PASSWORD: "x" },
        });
        driver.mqtt.options.reconnectPeriod = 200;
        let connects = 0, closes = 0;
        driver.mqtt.on("connect", () => connects++);
        driver.mqtt.on("close", () => closes++);
        t.after(() => driver.mqtt.end(true));
        driver.run();

        /* Today's broker: the driver subscribes and answers a hello. */
        await wait_for("the scout subscription",
            () => subscriptions(broker_log(brokers[0]), "Conn")
                .includes("fpEdge1/Conn/scout"));
        agent.publish("fpEdge1/Conn/scout", JSON.stringify({ op: "hello", version: 1 }));
        await wait_for("the hello answer", () => hellos.length == 1);
        assert.equal(hellos[0].supported, true);
        assert.equal(connects, 1);
        assert.equal(closes, 0);

        /* Roll back: the broker comes back with the old ACL and the
         * agent sends no features key. */
        features = null;
        stop_broker(brokers[0]);
        brokers.push(await start_broker(port, OLD_ACL));
        await wait_for("the driver to reconnect", () => connects == 2);
        await wait_for("the driver to be UP", () => driver.status == "UP");
        assert.equal(driver.scout_seen, false);
        /* Failed attempts while the broker was down each close too. */
        const closes_before = closes;

        /* Give a wrong subscription time to happen, and the broker time
         * to refuse it. */
        agent.publish("fpEdge1/Conn/scout", JSON.stringify({ op: "hello", version: 1 }));
        await timers.setTimeout(2000);

        const log = broker_log(brokers[1]);
        const subs = subscriptions(log, "Conn");
        assert.ok(subs.includes("fpEdge1/Conn/conf"), `driver subscriptions: ${subs}`);
        assert.ok(!subs.some(s => s.includes("scout")), `driver subscriptions: ${subs}`);
        assert.doesNotMatch(log, /Denied .*Conn/);
        assert.equal(connects, 2, "the driver reconnected more than once");
        assert.equal(closes, closes_before, "the driver was disconnected");
        assert.equal(hellos.length, 1);
    });
