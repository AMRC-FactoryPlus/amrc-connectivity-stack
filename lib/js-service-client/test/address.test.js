import { describe, it, expect } from "vitest";
import { Address } from "../lib/sparkplug/util.js";

describe("Address", () => {
    it("treats empty string device as node address", () => {
        const a = new Address("G", "N", "");
        expect(a.device).toBeUndefined();
    });

    it("treats null device as node address", () => {
        const a = new Address("G", "N", null);
        expect(a.device).toBeUndefined();
    });

    it("toString formats node address", () => {
        const a = new Address("G", "N");
        expect(a.toString()).toBe("G/N");
    });

    it("toString formats device address", () => {
        const a = new Address("G", "N", "D");
        expect(a.toString()).toBe("G/N/D");
    });

    it("equals compares by value", () => {
        const a = new Address("G", "N", "D");
        const b = new Address("G", "N", "D");
        expect(a.equals(b)).toBe(true);
    });

    it("equals returns false for different addresses", () => {
        const a = new Address("G", "N", "D1");
        const b = new Address("G", "N", "D2");
        expect(a.equals(b)).toBe(false);
    });

    it("parse round-trips with toString", () => {
        const a = new Address("G", "N", "D");
        const b = Address.parse(a.toString());
        expect(b.equals(a)).toBe(true);
    });

    it("parent_node returns node address", () => {
        const a = new Address("G", "N", "D");
        const parent = a.parent_node();
        expect(parent.group).toBe("G");
        expect(parent.node).toBe("N");
        expect(parent.device).toBeUndefined();
    });
});
