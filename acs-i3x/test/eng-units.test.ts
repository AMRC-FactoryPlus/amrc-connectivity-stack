/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Engineering units: a metric's Eng_Unit in its metadata, as the UNECE
 * code the vocabulary resolves it to (engUnit) and as configured
 * (system.Eng_Unit).
 */

import { afterAll, describe, expect, it } from "@jest/globals";
import express from "express";
import request from "supertest";

import { APIv1 } from "../lib/api-v1.js";
import { EngUnits } from "../lib/eng-units.js";
import { SubscriptionManager } from "../lib/subscriptions.js";
import { ValueCache } from "../lib/value-cache.js";
import { TestObjectTree } from "./helpers/isa95.js";
import { allowAll } from "./helpers/allow-all.js";

const HIERARCHY = "84ac3397-f3a2-440a-99e5-5bb9f6a75091";
const DEV = "dev-1";

const KWH = { code: "KWH", symbol: "kW·h", aliases: ["kWh"] };
const CEL = { code: "CEL", symbol: "°C" };

function devInfo(units: Record<string, string | undefined>) {
    const metrics = Object.fromEntries(Object.entries(units).map(([name, unit]) =>
        [name, { Sparkplug_Type: "Double", ...(unit === undefined ? {} : { Eng_Unit: unit }) }]));
    return {
        schema: "schema-top",
        sparkplugName: "Meter",
        originMap: {
            Schema_UUID: "schema-top",
            Instance_UUID: DEV,
            Device_Information: {
                Schema_UUID: "schema-di",
                ISA95_Hierarchy: { Schema_UUID: HIERARCHY, Enterprise: { Value: "AMRC" } },
            },
            Meter: { Schema_UUID: "schema-meter", ...metrics },
        },
    };
}

function setup(units?: EngUnits) {
    const tree = new TestObjectTree({ namespaceName: "NS", namespaceUri: "urn:ns", units });
    tree.addDevice(DEV, devInfo({
        Energy: "kWh",
        Temperature: "°C",
        Odd: "$.transformedReading",
        Count: undefined,
        Blank: "",
    }), { name: "Meter" });
    tree.setReady();
    const leaf = (name: string) => tree.getObjects().find(o => o.displayName === name)!;
    const meta = (name: string) => tree.objectMetadata(leaf(name));
    return { tree, leaf, meta };
}

function vocabulary(...units: any[]) {
    const u = new EngUnits();
    u.set(units);
    return u;
}

describe("EngUnits", () => {
    it("resolves a string by a unit's symbol or alias to its UNECE code", () => {
        const u = vocabulary(KWH, CEL);
        expect(u.code("kW·h")).toBe("KWH");
        expect(u.code("kWh")).toBe("KWH");
        expect(u.code("°C")).toBe("CEL");
        expect(u.code("KWH")).toBeUndefined();
        expect(u.code("$.transformedReading")).toBeUndefined();
    });

    it("is ready once read, and its revision changes with every read", () => {
        const u = new EngUnits();
        expect(u.isReady()).toBe(false);
        expect(u.code("kWh")).toBeUndefined();
        u.set([KWH]);
        const rev = u.revision();
        expect(u.isReady()).toBe(true);
        u.set([KWH, CEL]);
        expect(u.revision()).not.toBe(rev);
    });

    it("ignores configs that are not units", () => {
        const u = vocabulary(null, {}, { code: "X" }, KWH);
        expect(u.code("kWh")).toBe("KWH");
    });
});

describe("Unit metadata", () => {
    it("gives a metric whose Eng_Unit resolves its UNECE code and the string", () => {
        const { meta } = setup(vocabulary(KWH, CEL));
        expect(meta("Energy")).toMatchObject({ engUnit: "KWH", system: { Eng_Unit: "kWh" } });
        expect(meta("Temperature")).toMatchObject({ engUnit: "CEL", system: { Eng_Unit: "°C" } });
    });

    it("gives a metric whose Eng_Unit does not resolve only the string", () => {
        const { meta } = setup(vocabulary(KWH, CEL));
        const m = meta("Odd");
        expect(m).not.toHaveProperty("engUnit");
        expect(m.system).toEqual({ Eng_Unit: "$.transformedReading" });
    });

    it("gives a metric with no Eng_Unit, or an empty one, neither", () => {
        const { meta } = setup(vocabulary(KWH, CEL));
        for (const name of ["Count", "Blank"]) {
            expect(meta(name)).not.toHaveProperty("engUnit");
            expect(meta(name)).not.toHaveProperty("system");
        }
    });

    it("gives a composition neither", () => {
        const { meta } = setup(vocabulary(KWH, CEL));
        for (const name of ["Meter"]) {
            expect(meta(name)).not.toHaveProperty("engUnit");
            expect(meta(name)).not.toHaveProperty("system");
        }
    });

    it("gives only the string without a vocabulary", () => {
        const { meta } = setup();
        expect(meta("Energy")).not.toHaveProperty("engUnit");
        expect(meta("Energy").system).toEqual({ Eng_Unit: "kWh" });
    });

    it("follows changes to the vocabulary", () => {
        const units = vocabulary(CEL);
        const { meta } = setup(units);
        expect(meta("Energy")).not.toHaveProperty("engUnit");
        units.set([CEL, KWH]);
        expect(meta("Energy").engUnit).toBe("KWH");
    });

    it("follows a change to a metric's Eng_Unit", () => {
        const { tree, meta } = setup(vocabulary(KWH, CEL));
        tree.replaceDeviceSubtree(DEV, devInfo({ Energy: "°C" }), { name: "Meter" });
        expect(meta("Energy")).toMatchObject({ engUnit: "CEL", system: { Eng_Unit: "°C" } });
    });

    it("gives a metric found only on the UNS the Unit it was published with", () => {
        const { tree } = setup(vocabulary(KWH, CEL));
        const id = tree.addCompositionFromUns([DEV], ["schema-top"], ["Extra", "Load"], ["AMRC"],
            { deviceSegment: "Meter", type: "Double", unit: "kWh" })!;
        const leaf = tree.getObject(id)!;
        expect(tree.objectMetadata(leaf)).toMatchObject({ engUnit: "KWH", system: { Eng_Unit: "kWh" } });
        expect(tree.getMetricMeta(id)?.engUnit).toBe("kWh");
    });

    it("keeps the configured unit of a metric that is also on the UNS", () => {
        const { tree, leaf, meta } = setup(vocabulary(KWH, CEL));
        tree.addCompositionFromUns([DEV], ["schema-top"], ["Meter", "Energy"], ["AMRC"],
            { deviceSegment: "Meter", type: "Double", unit: "°C" });
        expect(leaf("Energy")).toBeDefined();
        expect(meta("Energy").system).toEqual({ Eng_Unit: "kWh" });
    });

    it("changes the metadata revision, not the tree revision, with the vocabulary", () => {
        const units = vocabulary(CEL);
        const { tree } = setup(units);
        const [rev, mrev] = [tree.revision(), tree.metadataRevision()];
        units.set([CEL, KWH]);
        expect(tree.revision()).toBe(rev);
        expect(tree.metadataRevision()).not.toBe(mrev);
    });
});

describe("Unit metadata over the API", () => {
    const units = vocabulary(CEL);
    const { tree } = setup(units);
    const valueCache = new ValueCache({ objectTree: tree, staleThreshold: 60_000 });
    const subscriptions = new SubscriptionManager({ valueCache, viewers: allowAll, ttl: 60_000 });
    const api = new APIv1({
        access: allowAll, objectTree: tree, valueCache, subscriptions,
        history: {} as any,
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).auth = "p@R"; next(); });
    app.use("/v1", api.routes);
    afterAll(() => subscriptions.destroy());

    const energy = (body: any) => body.result.find((o: any) => o.displayName === "Energy");

    it("lists engUnit and system as the i3X specification describes them", async () => {
        units.set([CEL, KWH]);
        const res = await request(app).get("/v1/objects?includeMetadata=true");
        const m = energy(res.body).metadata;
        expect(m.engUnit).toBe("KWH");
        for (const v of Object.values(m.system))
            expect(["string", "number", "boolean"]).toContain(typeof v);
    });

    it("gives a listing with metadata a new ETag when the vocabulary changes", async () => {
        units.set([CEL]);
        const first = await request(app).get("/v1/objects?includeMetadata=true");
        const plain = await request(app).get("/v1/objects");
        expect(energy(first.body).metadata).not.toHaveProperty("engUnit");

        units.set([CEL, KWH]);
        const again = await request(app).get("/v1/objects?includeMetadata=true")
            .set("If-None-Match", first.headers.etag);
        expect(again.status).toBe(200);
        expect(energy(again.body).metadata.engUnit).toBe("KWH");

        const plainAgain = await request(app).get("/v1/objects")
            .set("If-None-Match", plain.headers.etag);
        expect(plainAgain.status).toBe(304);
    });
});
