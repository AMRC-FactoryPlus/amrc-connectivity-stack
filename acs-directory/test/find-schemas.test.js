import { describe, it, expect } from "vitest";
import { MetricBranch } from "@amrc-factoryplus/service-client";
import MQTTCli from "../lib/mqttcli.js";

function make_cli() {
    return Object.create(MQTTCli.prototype);
}

describe("find_schemas", () => {
    it("returns empty set for empty tree", () => {
        const cli = make_cli();
        const result = cli.find_schemas({});
        expect(result.size).toBe(0);
    });

    it("finds top-level Schema_UUID", () => {
        const cli = make_cli();
        const tree = {
            Schema_UUID: { value: "schema-1" },
        };
        const result = cli.find_schemas(tree);
        expect([...result]).toEqual(["schema-1"]);
    });

    it("finds nested Schema_UUIDs in MetricBranch", () => {
        const cli = make_cli();
        const branch = new MetricBranch();
        branch.Schema_UUID = { value: "schema-nested" };
        const tree = { sub: branch };
        const result = cli.find_schemas(tree);
        expect(result.has("schema-nested")).toBe(true);
    });

    it("finds multiple schemas at different levels", () => {
        const cli = make_cli();
        const branch = new MetricBranch();
        branch.Schema_UUID = { value: "schema-2" };
        const tree = {
            Schema_UUID: { value: "schema-1" },
            sub: branch,
        };
        const result = cli.find_schemas(tree);
        expect(result.size).toBe(2);
        expect(result.has("schema-1")).toBe(true);
        expect(result.has("schema-2")).toBe(true);
    });

    it("deduplicates repeated schema UUIDs", () => {
        const cli = make_cli();
        const branch = new MetricBranch();
        branch.Schema_UUID = { value: "schema-1" };
        const tree = {
            Schema_UUID: { value: "schema-1" },
            sub: branch,
        };
        const result = cli.find_schemas(tree);
        expect(result.size).toBe(1);
    });
});
