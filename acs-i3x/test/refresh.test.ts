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
import { applyDiff } from "../lib/diff.js";
import { ObjectTree } from "../lib/object-tree.js";
import { createMockFplus } from "./helpers/mock-services.js";

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
