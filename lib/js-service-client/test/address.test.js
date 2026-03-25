import { describe, it, expect } from "vitest";
import { Address } from "../lib/sparkplug/util.js";

describe("Address interning", () => {
    it("returns the same object for identical node addresses", () => {
        const a = new Address("G", "N");
        const b = new Address("G", "N");
        expect(a).toBe(b);
    });

    it("returns the same object for identical device addresses", () => {
        const a = new Address("G", "N", "D");
        const b = new Address("G", "N", "D");
        expect(a).toBe(b);
    });

    it("returns different objects for different addresses", () => {
        const a = new Address("G", "N", "D1");
        const b = new Address("G", "N", "D2");
        expect(a).not.toBe(b);
    });

    it("treats empty string device as node address", () => {
        const a = new Address("G", "N", "");
        const b = new Address("G", "N");
        expect(a).toBe(b);
    });

    it("treats null device as node address", () => {
        const a = new Address("G", "N", null);
        const b = new Address("G", "N");
        expect(a).toBe(b);
    });

    it("works correctly with Set", () => {
        const set = new Set();
        const a = new Address("G", "N", "D");
        set.add(a);

        const b = new Address("G", "N", "D");
        expect(set.has(b)).toBe(true);

        set.delete(b);
        expect(set.has(a)).toBe(false);
    });

    it("parse returns interned instances", () => {
        const a = new Address("G", "N", "D");
        const b = Address.parse("G/N/D");
        expect(a).toBe(b);
    });

    it("parent_node returns interned instances", () => {
        const a = new Address("G", "N");
        const b = new Address("G", "N", "D").parent_node();
        expect(a).toBe(b);
    });
});
