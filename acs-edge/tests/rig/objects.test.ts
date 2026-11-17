/*
 * ACS Edge Agent
 * Split-driver cluster rig: the loader and remover against a fake
 * ConfigDB
 * Copyright 2026 University of Sheffield
 */

import fs from "fs";
import path from "path";

import { App, BuiltIn, Class, Service, conn_uuid, node_uuid } from "./acs";
import { fake_fplus } from "./fake-acs";
import { make_rig } from "./make-rig";
import { load, remove } from "./objects";
import type { Rig } from "./rig";

const EXAMPLES = path.join(__dirname, "examples");
const CLUSTER = "c0000000-0000-4000-8000-000000000001";
const CHART = "c0000000-0000-4000-8000-000000000002";
const OTHER = "c0000000-0000-4000-8000-000000000003";
const SPLIT_REST = "5ede3d8d-7a45-47e4-9ee3-c4be844e40b2";

function example_rig (): Rig {
    const sources = fs.readdirSync(EXAMPLES).sort().map(f => ({
        file: path.join(EXAMPLES, f),
        ...JSON.parse(fs.readFileSync(path.join(EXAMPLES, f), "utf8")),
    }));
    return make_rig(sources, {
        prefix: "Rig", namespace: "acs-rig", image: "i",
        seed: 1, duration_ms: 10_000, mqtt_interval_ms: 1000,
    });
}

/* A cluster with one edge cluster, the Manager's chart, and one Edge
 * Agent that isn't the rig's. */
async function cluster () {
    const fplus = fake_fplus();
    const cdb = fplus.ConfigDB;
    await cdb.put_config(App.EdgeClusterConfiguration, CLUSTER, { namespace: "edge" });
    await cdb.put_config(App.ServiceConfig, Service.Manager, { helm: { agent: CHART } });
    await cdb.create_object(Class.EdgeAgent, OTHER);
    await cdb.put_config(App.EdgeAgentDeployment, OTHER, { name: "Other", cluster: CLUSTER });
    await cdb.put_config(App.EdgeAgentConfig, OTHER, { deviceConnections: [] });
    cdb.writes = 0;
    return fplus;
}

const quiet = () => jest.spyOn(console, "log").mockImplementation(() => {});

describe("load", () => {
    beforeEach(() => { quiet(); });
    afterEach(() => jest.restoreAllMocks());

    test("a dry run writes nothing", async () => {
        const fplus = await cluster();
        const out = await load(example_rig(), { dry: true }, fplus);
        expect(out.writes).toBeGreaterThan(0);
        expect(fplus.ConfigDB.writes).toBe(0);
        expect(fplus.Fetch.secrets.size).toBe(0);
    });

    test("creates each node, connection and device as the Manager would", async () => {
        const rig = example_rig();
        const fplus = await cluster();
        const cdb = fplus.ConfigDB;
        await load(rig, { dry: false }, fplus);

        for (const node of rig.nodes) {
            const uuid = node_uuid(rig, node.name);
            expect(cdb.objects.get(uuid)).toBe(Class.EdgeAgent);
            expect(await cdb.get_config(App.Info, uuid)).toEqual({ name: node.name });
            expect(await cdb.get_config(App.EdgeAgentDeployment, uuid))
                .toMatchObject({ name: node.name, cluster: CLUSTER, chart: CHART });
            const config = await cdb.get_config(App.EdgeAgentConfig, uuid);
            expect(config.deviceConnections.length).toBe(1);
        }
        for (const c of rig.connections) {
            const uuid = conn_uuid(rig, c);
            const cconf = await cdb.get_config(App.ConnectionConfiguration, uuid);
            expect(cconf).toMatchObject({
                driver: BuiltIn[c.protocol], edgeAgent: node_uuid(rig, c.node),
                source: { payloadFormat: c.connection.payloadFormat },
                topology: { cluster: CLUSTER },
            });
            const agent = await cdb.get_config(App.EdgeAgentConfig, node_uuid(rig, c.node));
            const entry = agent.deviceConnections[0];
            expect(entry).toMatchObject({ uuid, name: c.name, connType: c.connection.connType });
            const devices = (await cdb.get_all_configs(App.DeviceInformation));
            expect([...devices.values()].filter(d => d.connection == uuid).length)
                .toBe(c.connection.devices.length);
        }

        /* The OPC UA example logs in: its password is sealed and the
         * configs hold the placeholder. */
        const op = rig.connections.find(c => c.protocol == "OPC UA")!;
        const key = `${CLUSTER}/secret/edge/edge-agent-sensitive-information-${node_uuid(rig, op.node)}/${op.secret}`;
        expect(fplus.Fetch.secrets.get(key)).toBe(op.password);
        const cconf = await cdb.get_config(App.ConnectionConfiguration, conn_uuid(rig, op));
        expect(cconf.config.password).toBe(op.secret);
    });

    test("a second run finds the same objects and writes the same values", async () => {
        const rig = example_rig();
        const fplus = await cluster();
        await load(rig, { dry: false }, fplus);
        const before = JSON.stringify([...fplus.ConfigDB.configs].map(([a, m]) => [a, [...m]]));
        const objects = fplus.ConfigDB.objects.size;
        await load(rig, { dry: false }, fplus);
        expect(fplus.ConfigDB.objects.size).toBe(objects);
        expect(JSON.stringify([...fplus.ConfigDB.configs].map(([a, m]) => [a, [...m]])))
            .toBe(before);
    });

    test("leaves a moved connection and its agent alone", async () => {
        const rig = example_rig();
        const fplus = await cluster();
        const cdb = fplus.ConfigDB;
        await load(rig, { dry: false }, fplus);

        const rest = rig.connections.find(c => c.protocol == "REST")!;
        const cuuid = conn_uuid(rig, rest), nuuid = node_uuid(rig, rest.node);
        const cconf = await cdb.get_config(App.ConnectionConfiguration, cuuid);
        await cdb.put_config(App.ConnectionConfiguration, cuuid, { ...cconf, driver: SPLIT_REST });
        const agent = await cdb.get_config(App.EdgeAgentConfig, nuuid);
        agent.deviceConnections[0].connType = "Driver";
        await cdb.put_config(App.EdgeAgentConfig, nuuid, agent);
        const deployment = await cdb.get_config(App.EdgeAgentDeployment, nuuid);
        await cdb.put_config(App.EdgeAgentDeployment, nuuid,
            { ...deployment, values: { drivers: { x: {} } } });

        const out = await load(rig, { dry: false }, fplus);
        expect(out.skipped).toBe(2);
        expect((await cdb.get_config(App.ConnectionConfiguration, cuuid)).driver).toBe(SPLIT_REST);
        expect((await cdb.get_config(App.EdgeAgentConfig, nuuid)).deviceConnections[0].connType)
            .toBe("Driver");
        expect((await cdb.get_config(App.EdgeAgentDeployment, nuuid)).values)
            .toEqual({ drivers: { x: {} } });
    });
});

describe("remove", () => {
    beforeEach(() => { quiet(); });
    afterEach(() => jest.restoreAllMocks());

    test("deletes everything the loader made and nothing else", async () => {
        const rig = example_rig();
        const fplus = await cluster();
        const cdb = fplus.ConfigDB;
        await load(rig, { dry: false }, fplus);

        const dry = await remove(rig, { dry: true }, fplus);
        expect(dry.deletions).toBeGreaterThan(0);
        expect(cdb.objects.size).toBeGreaterThan(1);

        await remove(rig, { dry: false }, fplus);
        expect([...cdb.objects.keys()]).toEqual([OTHER]);
        expect(fplus.Fetch.secrets.size).toBe(0);
        for (const [app, m] of cdb.configs)
            for (const obj of m.keys())
                expect([OTHER, CLUSTER, Service.Manager]).toContain(obj);
        expect(await cdb.get_config(App.EdgeAgentDeployment, OTHER))
            .toEqual({ name: "Other", cluster: CLUSTER });
    });
});
