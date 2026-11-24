/*
 * Edge Agent testing driver
 * Edge Scout: a made-up tree of test addresses
 * Copyright 2026 University of Sheffield
 *
 * The tree depends only on the options, so every scan with the same
 * options lists the same items with the same ids. Other options make
 * the scan fail, hang, slow down or repeat items, so the Edge Agent
 * and the Admin UI can be tested against each of those cases.
 *
 * Values are numbered 0 to size - 1. The top of the tree covers all
 * of them. Each folder splits its values into up to FANOUT
 * sub-folders, until `depth` folder levels, and the folders at the
 * last level hold the values. A folder with no values is left out.
 */

import { ScoutError } from "@amrc-factoryplus/edge-driver";

import { canonical_addr } from "./addr.js";

/* How many sub-folders each folder splits into. */
export const FANOUT = 4;

export const ScoutDefaults = {
    size:       100,
    depth:      2,
    delay_ms:   0,
    duplicates: false,
    fail:       null,
    hang:       false,
    after:      0,
};

const Ceilings = {
    size:       1000000,
    depth:      32,
    delay_ms:   60000,
    after:      1000000,
};

/* How many items `duplicates: true` sends twice. */
const DUPLICATES = 10;

const FAIL_CODES = new Set(["OPTIONS", "CONN", "AUTH", "ERR", "UNSUPPORTED"]);

const FUNCS = ["sin", "saw", "const"];
const FUNC_NAMES = { sin: "Sine wave", saw: "Sawtooth wave", const: "Constant" };
const PACKS = ["bd", "ld", "bf", "lf"];
const PACK_INFO = {
    bd: { type: "Double", order: "BE", name: "a big-endian double" },
    ld: { type: "Double", order: "LE", name: "a little-endian double" },
    bf: { type: "Float",  order: "BE", name: "a big-endian float" },
    lf: { type: "Float",  order: "LE", name: "a little-endian float" },
};

/* Check the options of a scan and fill in the defaults. Throws
 * ScoutError OPTIONS, which names the bad option. */
export function parse_options (options) {
    const opts = { ...ScoutDefaults };
    for (const [key, value] of Object.entries(options ?? {})) {
        if (!(key in ScoutDefaults))
            throw new ScoutError("OPTIONS", `Unknown option ${key}`);
        if (value == null) continue;
        opts[key] = value;
    }

    for (const key of ["size", "depth", "delay_ms", "after"]) {
        const v = opts[key];
        if (!Number.isInteger(v) || v < 0 || v > Ceilings[key])
            throw new ScoutError("OPTIONS",
                `Option ${key} must be a whole number from 0 to ${Ceilings[key]}`);
    }
    if (typeof opts.hang != "boolean")
        throw new ScoutError("OPTIONS", "Option hang must be true or false");
    if (typeof opts.duplicates != "boolean")
        throw new ScoutError("OPTIONS", "Option duplicates must be true or false");
    if (opts.fail != null && !FAIL_CODES.has(opts.fail))
        throw new ScoutError("OPTIONS",
            `Option fail must be one of ${[...FAIL_CODES].join(", ")}`);

    return opts;
}

/* The canonical address of value i. The period makes it unique. */
export function value_addr (i) {
    const func = FUNCS[i % FUNCS.length];
    const pack = PACKS[i % PACKS.length];
    return canonical_addr(`${func}:${1000 + i}:${1 + (i % 10)}:${pack}`);
}

/* The children of a node that covers values [lo, hi) at folder level
 * `level`. Returns folders as {path, lo, hi} and values as numbers. */
function children (node, depth) {
    const { lo, hi, path } = node;
    if (path.length >= depth) {
        const values = [];
        for (let i = lo; i < hi; i++) values.push(i);
        return { folders: [], values };
    }

    const n = hi - lo;
    const folders = [];
    for (let j = 0; j < FANOUT; j++) {
        const clo = lo + Math.floor(j * n / FANOUT);
        const chi = lo + Math.floor((j + 1) * n / FANOUT);
        if (chi > clo)
            folders.push({ path: [...path, j], lo: clo, hi: chi });
    }
    return { folders, values: [] };
}

export function folder_id (path) {
    return ["f", ...path].join("/");
}

/* Find the folder a branch scan starts at, from its id. Returns
 * undefined when there is no such folder for these options. */
export function find_folder (id, opts) {
    const parts = id.split("/");
    if (parts[0] != "f" || parts.length < 2 || parts.length - 1 > opts.depth)
        return;

    let node = { path: [], lo: 0, hi: opts.size };
    for (const part of parts.slice(1)) {
        if (!/^\d$/.test(part)) return;
        const j = Number(part);
        node = children(node, opts.depth).folders
            .find(f => f.path[f.path.length - 1] == j);
        if (!node) return;
    }
    return node;
}

function folder_item (node, more) {
    const { path } = node;
    return {
        id:     folder_id(path),
        parent: path.length > 1 ? folder_id(path.slice(0, -1)) : null,
        name:   `Group ${path.map(j => j + 1).join(".")}`,
        kind:   "folder",
        more,
        detail: { first: node.lo, count: node.hi - node.lo },
    };
}

function value_item (i, parent, handler, samples) {
    const address = value_addr(i);
    const [func, period, amplitude, pack] = address.split(":");
    const info = PACK_INFO[pack];
    const item = {
        id:             address,
        parent,
        name:           `Signal ${i}`,
        kind:           "value",
        address,
        /* The data packet is the packed number, at offset 0. */
        path:           "0",
        type:           info.type,
        access:         "r",
        description:    `${FUNC_NAMES[func]}, period ${period} ms, `
            + `amplitude ${amplitude}, sent as ${info.name}`,
        detail:         { index: i, byte_order: info.order },
    };
    if (samples) {
        const spec = handler.parseAddr(address);
        item.sample = String(spec.func(performance.now()));
    }
    return item;
}

/* Sleep for ms, waking early when the scan stops. */
function sleep (ms, signal) {
    return new Promise(resolve => {
        if (ms <= 0 || signal.aborted) return resolve();
        const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
        };
        const timer = setTimeout(done, ms);
        signal.addEventListener("abort", done);
    });
}

/* A promise that never settles, for the hang option. Nothing refers
 * to it once the library gives up on the scan, so it is collected. */
const never = () => new Promise(() => {});

/* The scout method of TestHandler. `handler` gives the address
 * parser, for samples. */
export async function scout_test (handler, req, out) {
    const opts = parse_options(req.options);
    const { limits, signal } = out;

    if (req.folder_id != null && req.folder_id !== req.root)
        throw new ScoutError("OPTIONS",
            `folder_id ${req.folder_id} is not the folder at root ${req.root}`);

    let start = { path: [], lo: 0, hi: opts.size, depth: 0 };
    if (req.root != null) {
        const node = find_folder(req.root, opts);
        if (!node)
            throw new ScoutError("OPTIONS",
                `Root ${req.root} is not a folder of this tree`);
        start = { ...node, depth: 0 };
    }

    let added = 0;
    const firsts = [];
    const add = async items => {
        if (!items.length) return;
        await out.add(items);
        added += items.length;
        for (const item of items)
            if (item.kind == "value" && firsts.length < DUPLICATES)
                firsts.push(item);
    };

    /* A request to the device: the fail and hang options take effect
     * here, then the device delay and the library's pace. */
    const request = async () => {
        if (added >= opts.after) {
            if (opts.fail)
                throw new ScoutError(opts.fail,
                    `The test driver was asked to fail with ${opts.fail}`);
            if (opts.hang)
                await never();
        }
        await sleep(opts.delay_ms, signal);
        await out.pace();
    };

    if (req.folder_id != null)
        await add([folder_item(start, false)]);

    let depth_cut = false;
    const queue = [start];
    for (let next = 0; next < queue.length; next++) {
        await request();
        if (signal.aborted) break;

        const node = queue[next];
        const { folders, values } = children(node, opts.depth);
        const parent = node.path.length ? folder_id(node.path) : null;
        const depth = node.depth + 1;

        const items = [];
        for (const folder of folders) {
            const more = depth >= limits.depth;
            items.push(folder_item(folder, more));
            if (more) depth_cut = true;
            else queue.push({ ...folder, depth });
        }
        for (const i of values)
            items.push(value_item(i, parent, handler, limits.samples));
        await add(items);
        out.progress({ visited: next + 1, note: parent ?? "top" });
    }

    if (opts.duplicates && !signal.aborted)
        await out.add(firsts);

    return {
        exhaustive: true,
        truncated:  depth_cut,
        reason:     depth_cut ? "depth" : null,
        excluded:   [],
    };
}
