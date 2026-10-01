/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Tests for the diff-dispatch logic that the reactive pipeline calls on
 * every emission after the first. The pipeline plumbing itself (RxJS
 * combineLatest / switchMap over notify-v2) is not exercised here — it
 * relies on a live ConfigDB WebSocket and is covered by e2e tests.
 */

import { jest } from "@jest/globals";
import * as rx from "rxjs";
import { applyDiff } from "../lib/diff.js";
import { ObjectTree } from "../lib/object-tree.js";
import { ObjectTreeRefresh } from "../lib/refresh.js";
import { I3xRag } from "../lib/rag/i3x-rag.js";
import {
    DEVICE_CLASS_UUID,
    DEVICE_INFORMATION_APP_UUID,
    INFO_APP_UUID,
} from "../lib/constants.js";
import { createMockFplus } from "./helpers/mock-services.js";
import { createMockValueCache, createMockHistory } from "./helpers/mock-rag.js";

const SCHEMA_UUID = "schema-diff-1";

function makeTree() {
    const fplus = createMockFplus();
    return new ObjectTree({
        fplus,
        namespaceName: "NS",
        namespaceUri: "urn:ns",
    });
}

function devInfo(uuid: string, sparkplugName = "Dev") {
    return {
        schema: SCHEMA_UUID,
        sparkplugName,
        originMap: { Schema_UUID: SCHEMA_UUID, Instance_UUID: uuid },
    };
}

describe("applyDiff", () => {
    it("dispatches addDevice when a device appears in the new emission", () => {
        const tree = makeTree();
        const spy = jest.spyOn(tree, "addDevice");

        applyDiff(
            { devices: new Map(), schemas: new Map() },
            {
                devices: new Map([["dev-A", { devInfo: devInfo("dev-A"), info: { name: "A" } }]]),
                schemas: new Map(),
            },
            tree);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith("dev-A", expect.any(Object), { name: "A" });
    });

    it("dispatches removeDevice when a device disappears", () => {
        const tree = makeTree();
        const spy = jest.spyOn(tree, "removeDevice");

        applyDiff(
            {
                devices: new Map([["dev-A", { devInfo: devInfo("dev-A"), info: { name: "A" } }]]),
                schemas: new Map(),
            },
            { devices: new Map(), schemas: new Map() },
            tree);

        expect(spy).toHaveBeenCalledWith("dev-A");
    });

    it("dispatches replaceDeviceSubtree when devInfo content changes", () => {
        const tree = makeTree();
        const spy = jest.spyOn(tree, "replaceDeviceSubtree");
        const old = { devInfo: devInfo("dev-A", "v1"), info: { name: "A" } };
        const fresh = { devInfo: devInfo("dev-A", "v2"), info: { name: "A" } };

        applyDiff(
            { devices: new Map([["dev-A", old]]), schemas: new Map() },
            { devices: new Map([["dev-A", fresh]]), schemas: new Map() },
            tree);

        expect(spy).toHaveBeenCalledWith("dev-A", fresh.devInfo, fresh.info);
    });

    it("dispatches updateDeviceName when only info.name changes", () => {
        const tree = makeTree();
        const renameSpy = jest.spyOn(tree, "updateDeviceName");
        const replaceSpy = jest.spyOn(tree, "replaceDeviceSubtree");

        const stableDevInfo = devInfo("dev-A");
        applyDiff(
            {
                devices: new Map([["dev-A", { devInfo: stableDevInfo, info: { name: "Old" } }]]),
                schemas: new Map(),
            },
            {
                devices: new Map([["dev-A", { devInfo: stableDevInfo, info: { name: "New" } }]]),
                schemas: new Map(),
            },
            tree);

        expect(renameSpy).toHaveBeenCalledWith("dev-A", "New");
        expect(replaceSpy).not.toHaveBeenCalled();
    });

    it("does nothing for a device whose configs are unchanged", () => {
        const tree = makeTree();
        const renameSpy = jest.spyOn(tree, "updateDeviceName");
        const replaceSpy = jest.spyOn(tree, "replaceDeviceSubtree");
        const addSpy = jest.spyOn(tree, "addDevice");

        const entry = { devInfo: devInfo("dev-A"), info: { name: "A" } };
        applyDiff(
            { devices: new Map([["dev-A", entry]]), schemas: new Map() },
            { devices: new Map([["dev-A", entry]]), schemas: new Map() },
            tree);

        expect(renameSpy).not.toHaveBeenCalled();
        expect(replaceSpy).not.toHaveBeenCalled();
        expect(addSpy).not.toHaveBeenCalled();
    });

    it("dispatches add/update/remove for schemas", () => {
        const tree = makeTree();
        const addSpy = jest.spyOn(tree, "addObjectType");
        const updateSpy = jest.spyOn(tree, "updateObjectType");
        const removeSpy = jest.spyOn(tree, "removeObjectType");

        applyDiff(
            {
                devices: new Map(),
                schemas: new Map([
                    ["sch-A", { schema: { title: "A-v1" }, info: { name: "A" } }],
                    ["sch-B", { schema: { title: "B-v1" }, info: { name: "B" } }],
                ]),
            },
            {
                devices: new Map(),
                schemas: new Map([
                    ["sch-A", { schema: { title: "A-v2" }, info: { name: "A" } }], // changed
                    ["sch-C", { schema: { title: "C-v1" }, info: { name: "C" } }], // new
                    // sch-B removed
                ]),
            },
            tree);

        expect(updateSpy).toHaveBeenCalledWith("sch-A",
            { title: "A-v2" }, { name: "A" });
        expect(addSpy).toHaveBeenCalledWith("sch-C",
            { title: "C-v1" }, { name: "C" });
        expect(removeSpy).toHaveBeenCalledWith("sch-B");
    });

    it("removes schemas after device removals so references don't dangle", () => {
        const tree = makeTree();
        const calls: string[] = [];
        jest.spyOn(tree, "removeDevice").mockImplementation((uuid: string) => {
            calls.push(`removeDevice:${uuid}`);
        });
        jest.spyOn(tree, "removeObjectType").mockImplementation((uuid: string) => {
            calls.push(`removeObjectType:${uuid}`);
        });

        applyDiff(
            {
                devices: new Map([["dev-A", { devInfo: devInfo("dev-A"), info: {} }]]),
                schemas: new Map([["sch-X", { schema: {}, info: {} }]]),
            },
            { devices: new Map(), schemas: new Map() },
            tree);

        const devIdx = calls.indexOf("removeDevice:dev-A");
        const schIdx = calls.indexOf("removeObjectType:sch-X");
        expect(devIdx).toBeGreaterThanOrEqual(0);
        expect(schIdx).toBeGreaterThan(devIdx);
    });
});

describe("ObjectTreeRefresh and the RAG", () => {
    /* A ConfigDB stand-in: one BehaviorSubject per (app, obj) config and
     * one for the Device class members. */
    function makePipeline (uuids: string[]) {
        const configs = new Map<string, rx.BehaviorSubject<any>>();
        const config = (app: string, obj: string) => {
            const key = `${app}:${obj}`;
            if (!configs.has(key)) configs.set(key, new rx.BehaviorSubject<any>(null));
            return configs.get(key)!;
        };
        for (const uuid of uuids) {
            config(DEVICE_INFORMATION_APP_UUID, uuid).next(devInfo(uuid));
            config(INFO_APP_UUID, uuid).next({ name: `Device ${uuid}` });
        }
        const members = new rx.BehaviorSubject({
            isEmpty: () => uuids.length === 0,
            [Symbol.iterator]: () => uuids[Symbol.iterator](),
        });

        const fplus: any = createMockFplus();
        fplus.ConfigDB.watch_members = (cls: string) => {
            expect(cls).toBe(DEVICE_CLASS_UUID);
            return members;
        };
        fplus.ConfigDB.watch_config = (app: string, obj: string) => config(app, obj);

        const objectTree = new ObjectTree({ fplus, namespaceName: "NS", namespaceUri: "urn:ns" });
        const i3xRag = new I3xRag(objectTree, createMockValueCache(), createMockHistory());
        i3xRag.init();
        return { fplus, objectTree, i3xRag, config };
    }

    it("does not rebuild the RAG on emissions, only on the next query", async () => {
        const uuids = ["dev-A", "dev-B", "dev-C"];
        const { fplus, objectTree, i3xRag, config } = makePipeline(uuids);
        const rebuild = jest.spyOn(i3xRag, "rebuild");

        await new ObjectTreeRefresh({ fplus, objectTree, i3xRag }).run();
        for (let k = 0; k < 20; k++) {
            config(INFO_APP_UUID, "dev-B").next({ name: `Renamed ${k}` });
        }

        expect(objectTree.getObject("dev-B")?.displayName).toBe("Renamed 19");
        expect(rebuild).not.toHaveBeenCalled();

        const hits = i3xRag.search("Renamed");
        expect(rebuild).toHaveBeenCalledTimes(1);
        expect(hits.map(h => [h.elementId, h.displayName]))
            .toEqual([["dev-B", "Renamed 19"]]);

        i3xRag.search("Device");
        i3xRag.nodeCount();
        expect(rebuild).toHaveBeenCalledTimes(1);
    });
});
