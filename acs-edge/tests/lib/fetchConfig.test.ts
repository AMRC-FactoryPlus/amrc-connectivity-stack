/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2025 AMRC
 */

import fs from "fs";
import os from "os";
import path from "path";

import { Translator, hasSecretPlaceholder } from "../../lib/translator";
import { reHashConf } from "../../utils/FormatConfig";

/* The pipeline as it ran on main: stringify, regex replace, parse. */
const FPSI = /__FPSI__(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{32})/g;
function mainPipeline (config: any, secretDir: string) {
    let valid = true;
    const replaced = JSON.stringify(config).replace(FPSI, match => {
        try { return fs.readFileSync(`${secretDir}/${match}`, "utf8"); }
        catch { valid = false; return "SECRET_NOT_FOUND"; }
    });
    const out = valid ? JSON.parse(replaced) : config;
    return { valid, config: out };
}

/* Small seeded PRNG so failures reproduce. */
function rng (seed: number) {
    return () => {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const HEX = "0123456789abcdef";
const NASTY = ['"', "\\", "\n", String.fromCharCode(0x2028), String.fromCharCode(0xe9),
    String.fromCharCode(0xd83d, 0xde00), "__", "_FPSI_", "__FPSI", "FPSI__", " "];

function token (r: () => number) {
    const h = (n: number) => Array.from({ length: n }, () => HEX[Math.floor(r() * 16)]).join("");
    return "__FPSI__" + (r() < 0.5
        ? `${h(8)}-${h(4)}-${h(4)}-${h(4)}-${h(12)}` : h(32));
}

function str (r: () => number, withToken: boolean) {
    let s = "";
    const n = Math.floor(r() * 5);
    for (let i = 0; i < n; i++) {
        const x = r();
        if (x < 0.4) s += NASTY[Math.floor(r() * NASTY.length)];
        else s += Math.floor(r() * 36).toString(36);
    }
    if (withToken) {
        const at = Math.floor(r() * (s.length + 1));
        s = s.slice(0, at) + token(r) + s.slice(at);
    }
    return s;
}

function tree (r: () => number, depth: number, withTokens: boolean): any {
    const x = r();
    if (depth <= 0 || x < 0.3) {
        const y = r();
        if (y < 0.5) return str(r, withTokens && r() < 0.2);
        if (y < 0.7) return Math.floor(r() * 1000) / 7;
        if (y < 0.85) return r() < 0.5;
        return null;
    }
    const n = Math.floor(r() * 4);
    if (x < 0.65) return Array.from({ length: n }, () => tree(r, depth - 1, withTokens));
    const o: any = {};
    for (let i = 0; i < n; i++)
        o[str(r, withTokens && r() < 0.1) || "k" + i] = tree(r, depth - 1, withTokens);
    return o;
}

describe("hasSecretPlaceholder", () => {
    it("agrees with the string regex across random trees", () => {
        const r = rng(12345);
        let hits = 0, misses = 0;
        for (let i = 0; i < 5000; i++) {
            const withTokens = i % 2 == 0;
            const t = tree(r, 1 + Math.floor(r() * 6), withTokens);
            const text = JSON.stringify(t);
            const regex = new RegExp(FPSI.source).test(text);
            const walk = hasSecretPlaceholder(t);
            /* The walk looks for the prefix only, as JSON.stringify
             * escapes nothing in it. So it must match the prefix test
             * on the stringified form exactly... */
            expect(walk).toBe(text.includes("__FPSI__"));
            /* ...and must never miss a full token. */
            if (regex) expect(walk).toBe(true);
            walk ? hits++ : misses++;
        }
        expect(hits).toBeGreaterThan(500);
        expect(misses).toBeGreaterThan(500);
    });

    it("finds a placeholder in a key, a value, a nested array and the root", () => {
        const t = "__FPSI__" + "a".repeat(32);
        expect(hasSecretPlaceholder(t)).toBe(true);
        expect(hasSecretPlaceholder({ [t]: 1 })).toBe(true);
        expect(hasSecretPlaceholder({ a: { b: [1, [2, [{ c: t }]]] } })).toBe(true);
        expect(hasSecretPlaceholder([[[[t]]]])).toBe(true);
        expect(hasSecretPlaceholder({ a: [1, "x", null, true, { b: "__FPSI_" }] })).toBe(false);
        expect(hasSecretPlaceholder(null)).toBe(false);
        expect(hasSecretPlaceholder(5)).toBe(false);
    });

    it("does not overflow the stack on a deeply nested config", () => {
        let t: any = "x";
        for (let i = 0; i < 200000; i++) t = [t];
        expect(hasSecretPlaceholder(t)).toBe(false);
    });
});

describe("Translator.fetchConfig", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    let dir: string;
    const saved = process.env.SECRETS_PATH;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "fpsi-"));
        process.env.SECRETS_PATH = dir;
        jest.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        if (saved === undefined) delete process.env.SECRETS_PATH;
        else process.env.SECRETS_PATH = saved;
        jest.restoreAllMocks();
    });

    function translatorFor (config: any) {
        const fplus: any = {
            ConfigDB: {
                get_config_with_etag: async () => [JSON.parse(JSON.stringify(config)), "etag"],
            },
        };
        return new Translator(fplus, 1, {} as any);
    }

    function deviceConfig (extra: any = {}) {
        return {
            sparkplug: { groupId: "g" },
            deviceConnections: [{
                name: "c", connType: "REST", pollInt: 5, payloadFormat: "JSON",
                ...extra,
                devices: [{
                    name: "d",
                    tags: [{ Name: "t", type: "FloatLE", recordToDB: true, address: "a" }],
                }],
            }],
        };
    }

    it("returns a config without placeholders as main does", async () => {
        const cfg = deviceConfig();
        const main = mainPipeline(cfg, dir);
        const got = await translatorFor(cfg).fetchConfig(uuid);
        expect(main.valid).toBe(true);
        expect(got.deviceConnections).toEqual(reHashConf(main.config).deviceConnections);
        expect(got.sparkplug.nodeControl).toEqual(cfg.sparkplug);
        expect(got.sparkplug.alerts).toEqual({ configFetchFailed: false, configInvalid: false });
    });

    it("returns random placeholder-free configs deep-equal to main", async () => {
        const r = rng(777);
        for (let i = 0; i < 200; i++) {
            const cfg = { sparkplug: tree(r, 3, false), deviceConnections: [] as any[] };
            const main = mainPipeline(cfg, dir);
            const got = await translatorFor(cfg).fetchConfig(uuid);
            expect(got.sparkplug.nodeControl).toEqual(main.config.sparkplug);
            expect(got.deviceConnections).toEqual(reHashConf(main.config).deviceConnections);
        }
    });

    it("fills secrets exactly as main does", async () => {
        const t1 = "__FPSI__" + "0123abcd-0123-4abc-8def-0123456789ab";
        const t2 = "__FPSI__" + "0123456789abcdef0123456789abcdef";
        fs.writeFileSync(`${dir}/${t1}`, 'pass word');
        fs.writeFileSync(`${dir}/${t2}`, "plain");
        const cfg = deviceConfig({
            password: t1,
            url: `http://u:${t2}@host/`,
            headers: { Authorization: `Bearer ${t2}` },
        });
        const main = mainPipeline(cfg, dir);
        const got = await translatorFor(cfg).fetchConfig(uuid);
        expect(main.valid).toBe(true);
        expect(got.deviceConnections).toEqual(reHashConf(main.config).deviceConnections);
        expect(got.deviceConnections![0].password).toBe(main.config.deviceConnections[0].password);
        expect(got.deviceConnections![0].url).toBe("http://u:plain@host/");
        expect(got.sparkplug.alerts!.configInvalid).toBe(false);
    });

    it("marks the config invalid when a secret breaks the JSON, as main does", async () => {
        const t = "__FPSI__" + "0123456789abcdef0123456789abcdef";
        fs.writeFileSync(`${dir}/${t}`, 'pa"ss');
        const cfg = deviceConfig({ password: t });
        expect(() => mainPipeline(cfg, dir)).toThrow();
        const got = await translatorFor(cfg).fetchConfig(uuid);
        expect(got.deviceConnections).toEqual([]);
        expect(got.sparkplug.alerts!.configInvalid).toBe(true);
    });

    it("marks the config invalid when a secret is missing, as main does", async () => {
        const cfg = deviceConfig({ password: "__FPSI__" + "0123456789abcdef0123456789abcdef" });
        const main = mainPipeline(cfg, dir);
        const got = await translatorFor(cfg).fetchConfig(uuid);
        expect(main.valid).toBe(false);
        expect(got.deviceConnections).toEqual([]);
        expect(got.sparkplug.alerts).toEqual({ configFetchFailed: false, configInvalid: true });
    });

    it("records the paths of missing secrets, and only those", async () => {
        const have = "__FPSI__" + "0123456789abcdef0123456789abcdef";
        const gone = "__FPSI__" + "fedcba9876543210fedcba9876543210";
        fs.writeFileSync(`${dir}/${have}`, "plain");
        const cfg = deviceConfig({ password: gone, user: have, url: `x${gone}` });
        const t = translatorFor(cfg);
        const got = await t.fetchConfig(uuid);
        expect(got.sparkplug.alerts!.configInvalid).toBe(true);
        expect(t.missingSecrets).toEqual([`${dir}/${gone}`]);
    });

    it("records no missing secrets when all are present", async () => {
        const t1 = "__FPSI__" + "0123456789abcdef0123456789abcdef";
        fs.writeFileSync(`${dir}/${t1}`, "plain");
        const t = translatorFor(deviceConfig({ password: t1 }));
        await t.fetchConfig(uuid);
        expect(t.missingSecrets).toEqual([]);
    });

    it("does not wait for a secret that is present but breaks the JSON", async () => {
        const t1 = "__FPSI__" + "0123456789abcdef0123456789abcdef";
        fs.writeFileSync(`${dir}/${t1}`, 'pa"ss');
        const t = translatorFor(deviceConfig({ password: t1 }));
        await t.fetchConfig(uuid);
        expect(t.missingSecrets).toEqual([]);
    });

    it("still takes the string path for a placeholder in a key", async () => {
        const t = "__FPSI__" + "0123456789abcdef0123456789abcdef";
        fs.writeFileSync(`${dir}/${t}`, "renamed");
        const cfg = deviceConfig({ headers: { [t]: "v" } });
        const got = await translatorFor(cfg).fetchConfig(uuid);
        expect((got.deviceConnections![0] as any).headers).toEqual({ renamed: "v" });
    });

    it("reports a missing config as before", async () => {
        const fplus: any = { ConfigDB: { get_config_with_etag: async () => [null, "e"] } };
        const got = await new Translator(fplus, 1, {} as any).fetchConfig(uuid);
        expect(got.sparkplug.alerts).toEqual({ configFetchFailed: true, configInvalid: false });
        expect(got.deviceConnections).toEqual([]);
    });
});

describe("Translator.waitForSecrets", () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "fpsi-wait-"));
        jest.spyOn(console, "log").mockImplementation(() => {});
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        jest.restoreAllMocks();
    });

    function translator () {
        const t = new Translator({} as any, 1, {} as any);
        const stop = jest.spyOn(t, "stop").mockImplementation(async () => {});
        return { t, stop };
    }

    it("restarts once every missing secret has appeared", async () => {
        const { t, stop } = translator();
        const a = `${dir}/__FPSI__a`, b = `${dir}/__FPSI__b`;
        const done = t.waitForSecrets([a, b]);
        await new Promise(r => setTimeout(r, 200));
        fs.writeFileSync(a, "x");
        await new Promise(r => setTimeout(r, 1300));
        expect(stop).not.toHaveBeenCalled();
        fs.writeFileSync(b, "y");
        await done;
        expect(stop).toHaveBeenCalledTimes(1);
    }, 10_000);

    it("sees a secret that arrives by a Kubernetes-style symlink swap", async () => {
        const { t, stop } = translator();
        const name = "__FPSI__a";
        /* As the kubelet lays out a secret volume: the file is a
         * symlink through ..data, which is itself a symlink swapped to
         * a new timestamped directory on each update. */
        fs.mkdirSync(`${dir}/..2026_10_07_1`);
        fs.symlinkSync("..2026_10_07_1", `${dir}/..data`);
        const done = t.waitForSecrets([`${dir}/${name}`]);
        await new Promise(r => setTimeout(r, 200));
        fs.mkdirSync(`${dir}/..2026_10_07_2`);
        fs.writeFileSync(`${dir}/..2026_10_07_2/${name}`, "x");
        fs.symlinkSync("..2026_10_07_2", `${dir}/..data_tmp`);
        fs.renameSync(`${dir}/..data_tmp`, `${dir}/..data`);
        fs.symlinkSync(`..data/${name}`, `${dir}/${name}`);
        await done;
        expect(stop).toHaveBeenCalledTimes(1);
    }, 10_000);

    it("never logs a secret value", async () => {
        const { t } = translator();
        const logs = console.log as jest.Mock;
        const p = `${dir}/__FPSI__a`;
        const done = t.waitForSecrets([p]);
        await new Promise(r => setTimeout(r, 100));
        fs.writeFileSync(p, "hunter2");
        await done;
        expect(JSON.stringify(logs.mock.calls)).not.toContain("hunter2");
    }, 10_000);

    it("gives up without restarting when the agent stops", async () => {
        const { t, stop } = translator();
        const done = t.waitForSecrets([`${dir}/__FPSI__a`]);
        await new Promise(r => setTimeout(r, 100));
        t.abort.abort();
        await done;
        fs.writeFileSync(`${dir}/__FPSI__a`, "x");
        expect(stop).not.toHaveBeenCalled();
    });
});
