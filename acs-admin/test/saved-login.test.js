/*
 * ACS Admin
 * Tests for the sign-in details kept across a page reload
 * Copyright 2026 University of Sheffield
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clear_login, load_login, save_login } from "../src/lib/saved-login.js";

class MemoryStorage {
    constructor () { this.map = new Map(); }
    getItem (k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem (k, v) { this.map.set(k, String(v)); }
    removeItem (k) { this.map.delete(k); }
}

const OPTS = { directory_url: "http://directory.example", username: "u", password: "p" };

describe("saved login", () => {
    let local, session;

    beforeEach(() => {
        local = new MemoryStorage();
        session = new MemoryStorage();
        vi.stubGlobal("localStorage", local);
        vi.stubGlobal("sessionStorage", session);
    });
    afterEach(() => vi.unstubAllGlobals());

    it("keeps the details in sessionStorage, never localStorage", () => {
        save_login(OPTS);
        expect(local.getItem("opts")).toBeNull();
        expect(JSON.parse(session.getItem("opts"))).toEqual(OPTS);
        expect(load_login()).toEqual(OPTS);
    });

    it("moves details an older Admin left in localStorage", () => {
        local.setItem("opts", JSON.stringify(OPTS));
        expect(load_login()).toEqual(OPTS);
        expect(local.getItem("opts")).toBeNull();
        expect(JSON.parse(session.getItem("opts"))).toEqual(OPTS);
    });

    it("prefers this tab's details over old localStorage ones, and still deletes those", () => {
        save_login(OPTS);
        local.setItem("opts", JSON.stringify({ ...OPTS, username: "old" }));
        expect(load_login()).toEqual(OPTS);
        expect(local.getItem("opts")).toBeNull();
    });

    it("clears both stores on sign out", () => {
        save_login(OPTS);
        local.setItem("opts", "{}");
        clear_login();
        expect(session.getItem("opts")).toBeNull();
        expect(local.getItem("opts")).toBeNull();
        expect(load_login()).toBeNull();
    });

    it("returns null for nothing saved or a broken value", () => {
        expect(load_login()).toBeNull();
        session.setItem("opts", "not json");
        expect(load_login()).toBeNull();
    });

    it("copes with storage that throws", () => {
        const boom = { getItem () { throw new Error("blocked"); },
            setItem () { throw new Error("blocked"); },
            removeItem () { throw new Error("blocked"); } };
        vi.stubGlobal("localStorage", boom);
        vi.stubGlobal("sessionStorage", boom);
        expect(() => save_login(OPTS)).not.toThrow();
        expect(load_login()).toBeNull();
        expect(() => clear_login()).not.toThrow();
    });
});
