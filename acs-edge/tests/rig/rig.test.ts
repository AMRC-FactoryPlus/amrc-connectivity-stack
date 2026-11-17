/*
 * ACS Edge Agent
 * Split-driver cluster rig: tests on the made-up example configs
 * Copyright 2026 University of Sheffield
 */

import fs from "fs";
import http from "http";
import net from "net";
import path from "path";

import mqtt from "mqtt";
import {
    AttributeIds, MessageSecurityMode, OPCUAClient, SecurityPolicy, UserTokenType,
} from "node-opcua";
import * as sparkplug from "sparkplug-payload";

import type { Captured } from "../golden/capture";
import { make_rig, manifests, requests, value_topics } from "./make-rig";
import { control, make_mock } from "./mocks";
import { sleep } from "./mocks/mock";
import { as_array } from "./mocks/mqtt";
import { Rig, RigConnection, rig_entry } from "./rig";
import { compare_summaries, summarise, watch } from "./summary";

const SpB = sparkplug.get("spBv1.0")!;
const EXAMPLES = path.join(__dirname, "examples");

function example_rig (): Rig {
    const sources = fs.readdirSync(EXAMPLES).sort().map(f => {
        const j = JSON.parse(fs.readFileSync(path.join(EXAMPLES, f), "utf8"));
        return { file: path.join(EXAMPLES, f), ...j };
    });
    return make_rig(sources, {
        prefix: "Rig", namespace: "acs-rig", image: "acs-rig-mocks:test",
        seed: 1, duration_ms: 20_000, mqtt_interval_ms: 200,
    });
}

const by_proto = (rig: Rig, p: string) =>
    rig.connections.find(c => c.protocol == p)!;

/* The same connection on a port no other test uses. */
const on_port = (c: RigConnection, port: number) => ({ ...c, port });

/* The OPC UA example with security mode and policy None and a login. */
function none_with_login (c: RigConnection, port: number): RigConnection {
    const details = { ...c.connection.OPCUAConnDetails,
        securityMode: "None", securityPolicy: "None", useCredentials: true };
    return { ...c, port, connection: { ...c.connection, OPCUAConnDetails: details } };
}

function get (url: string) {
    return new Promise<string>((resolve, reject) =>
        http.get(url, { agent: false }, r => {
            let body = "";
            r.on("data", d => body += d);
            r.on("end", () => resolve(body));
        }).on("error", reject));
}

/* Whether a new connection to the port is cut straight away. */
function cut (port: number) {
    return new Promise<boolean>(resolve => {
        const sock = net.connect(port, "127.0.0.1");
        const timer = setTimeout(() => { sock.destroy(); resolve(false); }, 1000);
        sock.on("error", () => {});
        sock.once("close", () => { clearTimeout(timer); resolve(true); });
    });
}

describe("make_rig", () => {
    const rig = example_rig();

    test("one node per source agent and one connection per config", () => {
        expect(rig.nodes.map(n => n.name).sort()).toEqual([
            "Rig_Example_MQTT", "Rig_Example_OPCUA", "Rig_Example_REST", "Rig_Example_UDP",
        ]);
        expect(rig.connections.map(c => `${c.id} ${c.name} ${c.port}`).sort()).toEqual([
            "mqtt-1 Rig-sample-mqtt-json 1883",
            "opcua-1 Rig-sample-opcua 4840",
            "rest-1 Rig-sample-rest-xml 8080",
            "udp-1 Rig-sample-udp-json 50205",
        ]);
    });

    test("made-up credentials only where the source logs in", () => {
        const op = by_proto(rig, "OPC UA");
        expect(op.username).toBe("sample-user");
        expect(op.password).toMatch(/^[\w-]{16}$/);
        expect(op.password).not.toBe("REDACTED");
        expect(op.secret).toMatch(/^__FPSI__[0-9a-f]{32}$/);
        expect(by_proto(rig, "REST").password).toBeUndefined();
        expect(by_proto(rig, "MQTT").password).toBeUndefined();
    });

    test("each Edge Agent asks for its own resources, not the chart's", () => {
        for (const n of rig.nodes)
            expect(n.values).toEqual({ limits: { cpu: "50m", memory: "200Mi" } });
        expect(requests(rig).agents).toEqual({ cpu: 200, memory: 800 });
        expect(requests(rig).mocks).toEqual({ cpu: 60, memory: 896 });
    });

    test("a batched connection gets array topics and its agent a pinned image", () => {
        const sources = fs.readdirSync(EXAMPLES).sort().map(f => ({
            file: path.join(EXAMPLES, f),
            ...JSON.parse(fs.readFileSync(path.join(EXAMPLES, f), "utf8")),
        }));
        const mq = sources.find(s => s.connection.connType == "MQTT")!;
        mq.connection.devices[0].tags.push({ Name: "Batched", type: "Float",
            method: "GET", address: "batched/topic", path: "$.value" });
        const r = make_rig(sources, {
            prefix: "Rig", namespace: "acs-rig", image: "i", seed: 1,
            duration_ms: 10_000, mqtt_interval_ms: 1000,
            batched: ["mqtt-json"], pin_tag: "v1.2.3",
        });
        const c = r.connections.find(c => c.protocol == "MQTT")!;
        expect(c.array_topics).toContain("batched/topic");
        expect(c.array_topics).toEqual(value_topics(c.connection));
        expect(r.nodes.find(n => n.name == c.node)!.values.image)
            .toEqual({ default: { tag: "v1.2.3" } });
        expect(r.nodes.filter(n => n.values.image).length).toBe(1);
    });

    test("manifests run a pod per protocol except UDP", () => {
        const list = JSON.parse(manifests(rig, "img:1", Buffer.from("x")));
        const deps = list.items.filter((i: any) => i.kind == "Deployment");
        expect(deps.map((d: any) => d.metadata.name).sort())
            .toEqual(["rig-mqtt", "rig-opcua", "rig-rest"]);
        const op = deps.find((d: any) => d.metadata.name == "rig-opcua");
        const ctr = op.spec.template.spec.containers[0];
        expect(ctr.image).toBe("img:1");
        expect(ctr.args).toEqual(["run-mocks", "--rig", "/rig/rig.json.gz",
            "--protocol", "OPC UA", "--advertise", "rig-opcua.acs-rig.svc.cluster.local"]);
        expect(ctr.ports.map((p: any) => p.containerPort)).toEqual([4840, 9000]);
    });
});

describe("batched payloads", () => {
    test("value topics are those whose every metric reads $.value", () => {
        const conn = { devices: [
            { tags: [
                { address: "a", path: "$.value" },
                { address: "b", path: "$.value" },
                { address: "b", path: "$.other" },
                { Name: "static" },
            ] },
            { tags: [{ address: "c", path: "$.value" }] },
        ] };
        expect(value_topics(conn)).toEqual(["a", "c"]);
    });

    test("an object payload becomes an array of {value, timestamp}", () => {
        const out = JSON.parse(as_array(JSON.stringify({ value: 4.5 })).toString());
        expect(out).toEqual([{ value: 4.5, timestamp: expect.any(Number) }]);
    });
});

describe("rig_entry", () => {
    const rig = example_rig();
    const pw = (c: RigConnection) => c.secret;

    test("points each protocol at its mock and changes nothing else", () => {
        for (const c of rig.connections) {
            const e = rig_entry(c, { host: "h", password: pw, uuid: "u" });
            expect(e.name).toBe(c.name);
            expect(e.uuid).toBe("u");
            expect(e.devices).toEqual(c.connection.devices);
            expect(e.connType).toBe(c.connection.connType);
            expect(e.payloadFormat).toBe(c.connection.payloadFormat);
        }
        const op = rig_entry(by_proto(rig, "OPC UA"), { host: "h", password: pw });
        expect(op.OPCUAConnDetails).toEqual({
            ...by_proto(rig, "OPC UA").connection.OPCUAConnDetails,
            endpoint: "opc.tcp://h:4840",
            username: "sample-user",
            password: by_proto(rig, "OPC UA").secret,
        });
        const mq = rig_entry(by_proto(rig, "MQTT"), { host: "h", password: pw });
        expect(mq.MQTTConnDetails).toMatchObject({ protocol: "mqtt", host: "h", port: 1883 });
        const rs = rig_entry(by_proto(rig, "REST"), { host: "h", password: pw });
        expect(rs.RESTConnDetails.baseURL).toBe("http://h:8080");
        const ud = rig_entry(by_proto(rig, "UDP"), { host: "h", password: pw });
        expect(ud.UDPConnDetails).toEqual({ port: 50205 });
    });

    test("replaces only the Instance_UUID tag of the named devices", () => {
        const c = by_proto(rig, "OPC UA");
        const dev = c.connection.devices[0];
        const e = rig_entry(c, { host: "h", password: pw,
            devices: { [dev.deviceId]: "11111111-1111-4111-8111-111111111111" } });
        const tags = e.devices[0].tags;
        for (const [i, t] of tags.entries()) {
            if (t.Name == "Instance_UUID")
                expect(t.value).toBe("11111111-1111-4111-8111-111111111111");
            else
                expect(t).toEqual(dev.tags[i]);
        }
    });
});

describe("mocks", () => {
    const rig = example_rig();

    test("REST serves each address with the fixture's body", async () => {
        const c = on_port(by_proto(rig, "REST"), 18080);
        const mock = make_mock(rig, c);
        await mock.start();
        try {
            const addr = c.connection.devices[0].tags.find((t: any) => t.address).address;
            const res = await new Promise<http.IncomingMessage & { body: string }>((resolve, reject) =>
                http.get(`http://127.0.0.1:18080${addr}`, r => {
                    let body = "";
                    r.on("data", d => body += d);
                    r.on("end", () => resolve(Object.assign(r, { body })));
                }).on("error", reject));
            expect(res.statusCode).toBe(200);
            expect(res.headers["content-type"]).toMatch(/xml/);
            expect(res.body).toMatch(/^<\?xml/);
            expect(mock.status().delivered).toBe(1);
        }
        finally {
            await mock.stop();
        }
    });

    test("MQTT publishes the fixture's topics", async () => {
        const c = on_port(by_proto(rig, "MQTT"), 11883);
        const mock = make_mock(rig, c);
        await mock.start();
        const client = mqtt.connect("mqtt://127.0.0.1:11883");
        try {
            const topics = c.connection.devices.flatMap((d: any) =>
                d.tags.filter((t: any) => t.address).map((t: any) => t.address));
            await client.subscribeAsync("#");
            const got = await new Promise<string>(resolve =>
                client.on("message", t => resolve(t)));
            expect(topics).toContain(got);
        }
        finally {
            await client.endAsync();
            await mock.stop();
        }
    });

    test("OPC UA accepts only its security settings and login", async () => {
        const c = on_port(by_proto(rig, "OPC UA"), 14840);
        const mock = make_mock(rig, c, { advertise: "127.0.0.1" });
        await mock.start();
        const client = OPCUAClient.create({
            securityMode: MessageSecurityMode.SignAndEncrypt,
            securityPolicy: SecurityPolicy.Basic256,
            endpointMustExist: false,
            connectionStrategy: { maxRetry: 0 },
        });
        try {
            await client.connect("opc.tcp://127.0.0.1:14840");
            await expect(client.createSession({
                type: UserTokenType.UserName, userName: c.username!, password: "wrong",
            })).rejects.toThrow();
            const session = await client.createSession({
                type: UserTokenType.UserName, userName: c.username!, password: c.password!,
            });
            const tag = c.connection.devices[0].tags.find((t: any) => t.address);
            const dv = await session.read({ nodeId: tag.address, attributeId: AttributeIds.Value });
            expect(dv.statusCode.isGood()).toBe(true);
            await session.close();
        }
        finally {
            await client.disconnect();
            await mock.stop();
        }
    }, 60_000);
});

describe("mock controls", () => {
    const rig = example_rig();
    beforeEach(() => { jest.spyOn(console, "log").mockImplementation(() => {}); });
    afterEach(() => jest.restoreAllMocks());

    test("OPC UA with security None and a login lets the client log in", async () => {
        const c = none_with_login(by_proto(rig, "OPC UA"), 14841);
        const mock = make_mock(rig, c, { advertise: "127.0.0.1" });
        await mock.start();
        const client = OPCUAClient.create({
            securityMode: MessageSecurityMode.None,
            securityPolicy: SecurityPolicy.None,
            endpointMustExist: false,
            connectionStrategy: { maxRetry: 0 },
        });
        try {
            await client.connect("opc.tcp://127.0.0.1:14841");
            await expect(client.createSession({
                type: UserTokenType.UserName, userName: c.username!, password: "wrong",
            })).rejects.toThrow();
            const session = await client.createSession({
                type: UserTokenType.UserName, userName: c.username!, password: c.password!,
            });
            await session.close();
            await expect(client.createSession()).rejects.toThrow();
        }
        finally {
            await client.disconnect();
            await mock.stop();
        }
    }, 60_000);

    test("OPC UA holds a set value through a drop, with the server up", async () => {
        const c = none_with_login(by_proto(rig, "OPC UA"), 14842);
        const node = "ns=2;s=Sample/Node_01";
        const mock = make_mock(rig, c, { advertise: "127.0.0.1" });
        await mock.start();
        const client = OPCUAClient.create({
            endpointMustExist: false,
            connectionStrategy: { initialDelay: 100, maxDelay: 300, maxRetry: 100 },
        });
        const read = async (session: any) =>
            (await session.read({ nodeId: node, attributeId: AttributeIds.Value })).value.value;
        try {
            await client.connect("opc.tcp://127.0.0.1:14842");
            const session = await client.createSession({
                type: UserTokenType.UserName, userName: c.username!, password: c.password!,
            });

            await control(mock, "freeze", new URLSearchParams(), "");
            const held = await read(session);
            await sleep(1500);
            expect(await read(session)).toBe(held);

            mock.drop!(2000);
            expect(mock.status().running).toBe(true);
            expect(mock.status().dropped_until).toBeDefined();
            expect(await cut(14842)).toBe(true);
            await control(mock, "set", new URLSearchParams(),
                JSON.stringify({ address: node, value: 1234.5 }));
            await sleep(2000);

            let got;
            for (let i = 0; i < 50 && got === undefined; i++) {
                try { got = await read(session); }
                catch { await sleep(200); }
            }
            expect(got).toBe(1234.5);
            expect(mock.status().writes).toEqual([]);
            await session.close();
        }
        finally {
            await client.disconnect();
            await mock.stop();
        }
    }, 60_000);

    test("MQTT stops publishing when frozen, sends a set payload, and drops clients", async () => {
        const c = on_port(by_proto(rig, "MQTT"), 11884);
        const mock = make_mock(rig, c);
        await mock.start();
        mock.freeze!(true);
        const client = mqtt.connect("mqtt://127.0.0.1:11884", { reconnectPeriod: 0 });
        try {
            const got: [string, string][] = [];
            client.on("message", (t, p) => got.push([t, p.toString()]));
            await client.subscribeAsync("#");
            await sleep(1000);
            expect(got).toEqual([]);

            const topic = c.connection.devices[0].tags.find((t: any) => t.address).address;
            await mock.set!(topic, '{"x": 1}');
            await sleep(200);
            expect(got.length).toBe(1);
            expect(got[0][0]).toBe(topic);

            const closed = new Promise<void>(r => client.once("close", () => r()));
            mock.drop!(1000);
            await closed;
            expect(await cut(11884)).toBe(true);
            expect(mock.status()).toMatchObject({ running: true, frozen: true });
        }
        finally {
            await client.endAsync(true);
            await mock.stop();
        }
    });

    test("REST holds its bodies when frozen and serves a set body until thawed", async () => {
        const c = on_port(by_proto(rig, "REST"), 18081);
        const mock = make_mock(rig, c);
        await mock.start();
        try {
            const addr = c.connection.devices[0].tags.find((t: any) => t.address).address;
            const url = `http://127.0.0.1:18081${addr}`;
            await control(mock, "freeze", new URLSearchParams(), "");
            const before = await get(url);
            await control(mock, "set", new URLSearchParams(),
                JSON.stringify({ address: addr, value: "<x>1</x>" }));
            expect(await get(url)).toBe("<x>1</x>");
            await control(mock, "thaw", new URLSearchParams(), "");
            expect(await get(url)).not.toBe("<x>1</x>");
            expect(mock.status().frozen).toBe(false);

            await control(mock, "drop", new URLSearchParams("seconds=1"), "");
            expect(await cut(18081)).toBe(true);
            await sleep(1100);
            expect(await get(url)).toBeTruthy();
            expect(before).toBeTruthy();
        }
        finally {
            await mock.stop();
        }
    });

    test("a mock that can't take a control says so", async () => {
        const udp = make_mock(rig, by_proto(rig, "UDP"));
        await expect(control(udp, "freeze", new URLSearchParams(), ""))
            .rejects.toThrow(/can't freeze/);
    });
});

describe("summaries", () => {
    const rig: Rig = {
        ...example_rig(),
        nodes: [{ name: "N", agent: "", sparkplug: {} }],
    };
    const mq = by_proto(rig, "MQTT");
    const dev = mq.connection.devices[0];
    const conn = { ...mq, node: "N", connection: { ...mq.connection, devices: [dev] } };
    rig.connections = [conn];
    const read = dev.tags.find((t: any) => t.address);

    const msg = (kind: string, at: number, metrics: any[], device?: string): Captured => ({
        kind: kind as any, device, at,
        bytes: SpB.encodePayload({ timestamp: at, metrics }),
    });
    const recording = (type: string, every_ms: number) => {
        const msgs = [
            msg("NBIRTH", 0, []),
            msg("DBIRTH", 0, [{ name: read.Name, alias: 1, type, value: 0 }], dev.deviceId),
        ];
        for (let t = every_ms; t < 10_000; t += every_ms)
            msgs.push(msg("DDATA", t, [{ alias: 1, type, value: t }], dev.deviceId));
        return summarise(rig, type, 0, 10_000, new Map([["N", msgs]]));
    };

    test("a recording is summarised per device", () => {
        const s = recording("Float", 1000);
        const d = s.devices[`N/${dev.deviceId}`];
        expect(d.born).toBe(true);
        expect(d.ddata).toBe(9);
        expect(d.ddata_per_s).toBeCloseTo(0.9);
        expect(d.longest_gap_s).toBe(1);
        expect(d.metrics[read.Name]).toMatchObject({ type: "Float", values: 9, distinct: 9 });
    });

    test("the same recording compares clean", () => {
        expect(compare_summaries(recording("Float", 1000), recording("Float", 1000))).toEqual([]);
    });

    test("a changed type or a multiplied rate fails", () => {
        const types = compare_summaries(recording("Float", 1000), recording("Double", 1000));
        expect(types.some(p => p.level == "FAIL" && /type Float/.test(p.what))).toBe(true);
        const rate = compare_summaries(recording("Float", 1000), recording("Float", 250));
        expect(rate.some(p => p.level == "FAIL" && /DDATA rate/.test(p.what))).toBe(true);
        const more = compare_summaries(recording("Float", 1000), recording("Float", 500));
        expect(more.map(p => p.level)).toEqual(["WARN"]);
    });

    test("a watched metric shows each value, death and birth in order", () => {
        const d = dev.deviceId;
        const msgs = [
            msg("DBIRTH", 0, [{ name: read.Name, alias: 1, type: "Float", value: 1 },
                { name: "Other", alias: 2, type: "Float", value: 0 }], d),
            msg("DDATA", 1000, [{ alias: 2, type: "Float", value: 5 }], d),
            msg("DDATA", 2000, [{ alias: 1, type: "Float", value: 2 }], d),
            msg("DDEATH", 3000, [], d),
            msg("DBIRTH", 9000, [{ name: read.Name, alias: 1, type: "Float", value: 7 }], d),
            msg("DDATA", 9500, [{ alias: 1, type: "Float", value: 8 }], "another"),
        ];
        expect(watch(msgs, d, read.Name, 0)).toEqual([
            { at: 0, kind: "DBIRTH", value: "1" },
            { at: 2, kind: "DDATA", value: "2" },
            { at: 3, kind: "DDEATH" },
            { at: 9, kind: "DBIRTH", value: "7" },
        ]);
    });
});
