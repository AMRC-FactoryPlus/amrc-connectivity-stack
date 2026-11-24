/*
 * ACS simulator driver
 * Edge Scout: list the loaded cassette's channels and the player
 * Copyright 2026 University of Sheffield
 *
 * This is the reference scouter for JavaScript drivers. The library
 * does the protocol, so a scouter only checks its request, lists items
 * through out.add, and returns the result.
 *
 * Channel paths split on "/" into folders. A folder's id is its path
 * prefix with a trailing "/", such as "Axes/X/", and a channel's id is
 * its path, which is also its address. A channel whose path is also a
 * prefix of other channels, such as "A" beside "A/B", therefore has
 * both a value "A" and a folder "A/". The player's addresses sit in
 * their own folder, "player:". With no cassette loaded the scan finds
 * nothing.
 */

import { ScoutError } from "@amrc-factoryplus/edge-driver";

/* The id of the folder holding the player's addresses. No channel can
 * use it, because parseAddr reads every player: address as a player
 * address. */
export const PLAYER_FOLDER = "player:";

/* The path into the driver's JSON payload, {value, timestamp}. */
const VALUE_PATH = "$.value";

/* How many items go to out.add at once. */
const BATCH = 500;

const MAX_SAMPLE = 256;
const MAX_UNIT = 64;

/* Sparkplug B type names without a byte order. */
const PLAIN_TYPES = new Set([
    "Int8", "Int16", "Int32", "Int64",
    "UInt8", "UInt16", "UInt32", "UInt64",
    "Float", "Double", "Boolean", "String", "Text",
    "DateTime", "UUID", "Bytes", "File", "DataSet", "Template",
]);

/* The player's addresses, as listed in docs/cassette-format.md. */
export const PlayerItems = [
    ["load",        "w", "String",  "Load a cassette, given its UUID"],
    ["eject",       "w", null,      "Unload the cassette"],
    ["play",        "w", "String",  "Start or resume playing, with optional start_time, rate and loop as JSON"],
    ["pause",       "w", null,      "Stop sending samples and keep the position"],
    ["stop",        "w", null,      "Stop and rewind to the start"],
    ["seek",        "w", "String",  "Jump to a position in ms"],
    ["rate",        "w", "Double",  "Change the playing rate, from 0 to 100"],
    ["status",      "r", "String",  "EMPTY, LOADED, PLAYING, PAUSED or ENDED"],
    ["cassette",    "r", "String",  "The loaded cassette"],
    ["position",    "r", "Int64",   "Position in the cassette in ms"],
    ["rate_actual", "r", "Double",  "The rate samples are playing at"],
    ["error",       "r", "String",  "The last command error"],
].map(([verb, access, type, description]) => ({ verb, access, type, description }));

/* A Sparkplug type name without byte order from a cassette channel's
 * informational type, such as DoubleLE. Null when there is none. */
export function plain_type (type) {
    if (typeof type != "string") return null;
    if (PLAIN_TYPES.has(type)) return type;
    const base = type.replace(/(LE|BE)$/, "");
    return PLAIN_TYPES.has(base) ? base : null;
}

function clip (str, len) {
    return str.length > len ? str.slice(0, len) : str;
}

function as_text (value) {
    if (value === undefined || value === null) return null;
    const text = typeof value == "string" ? value : JSON.stringify(value);
    return clip(text, MAX_SAMPLE);
}

/* The latest value of each channel at a position in the cassette. */
function values_at (cassette, position) {
    const values = new Map();
    for (const [off, ch, value] of cassette.samples) {
        if (off > position) break;
        values.set(ch, value);
    }
    return values;
}

/* Build the whole tree. Returns `kids`, a map from folder id (null
 * for the top) to its child items in listing order, and `items`, a map
 * from id to item. A channel whose id, or one of whose folder ids, is
 * already used by another item is skipped and logged. */
export function build_tree (opts) {
    const { cassette, player, samples, log } = opts;
    const kids = new Map([[null, []]]);
    const items = new Map();
    if (!cassette) return { kids, items };

    const put = item => {
        if (items.has(item.id)) {
            log?.("Scout: skipping a second item with id %s", item.id);
            return;
        }
        items.set(item.id, item);
        kids.get(item.parent).push(item);
        if (item.kind == "folder") kids.set(item.id, []);
    };

    const now = samples ? values_at(cassette, player?.position ?? 0) : null;
    const state = samples ? player?.state() : null;

    put({
        id: PLAYER_FOLDER, parent: null, name: "Player", kind: "folder",
        more: false, description: "The cassette player's controls and state",
    });
    for (const p of PlayerItems) {
        const item = {
            id:             `player:${p.verb}`,
            parent:         PLAYER_FOLDER,
            name:           p.verb,
            kind:           "value",
            address:        `player:${p.verb}`,
            path:           p.access == "r" ? VALUE_PATH : null,
            type:           p.type,
            access:         p.access,
            description:    p.description,
        };
        if (state && p.access == "r") {
            const value = p.verb == "rate_actual" ? state.rate : state[p.verb];
            item.sample = as_text(value);
        }
        put(item);
    }

    for (const ch of cassette.channels) {
        const segments = ch.path.split("/");
        let parent = null;
        for (let i = 1; i < segments.length && parent !== undefined; i++) {
            const id = segments.slice(0, i).join("/") + "/";
            if (!kids.has(id)) {
                if (items.has(id)) {
                    log?.("Scout: skipping channel %s, because %s is not a folder",
                        ch.path, id);
                    parent = undefined;
                    break;
                }
                put({
                    id, parent, name: segments[i - 1], kind: "folder", more: false,
                });
            }
            parent = id;
        }
        if (parent === undefined) continue;

        const item = {
            id:         ch.path,
            parent,
            name:       segments.at(-1),
            kind:       "value",
            address:    ch.path,
            path:       VALUE_PATH,
            type:       plain_type(ch.type),
            access:     "r",
            detail:     { channel: ch.id },
        };
        if (typeof ch.engUnit == "string" && ch.engUnit.length)
            item.unit = clip(ch.engUnit, MAX_UNIT);
        if (typeof ch.type == "string")
            item.detail.cassette_type = clip(ch.type, 64);
        if (now)
            item.sample = as_text(now.get(ch.id));
        put(item);
    }
    return { kids, items };
}

/* The scout method of SimHandler. */
export async function scout_cassette (opts, req, out) {
    const { cassette, player, log } = opts;
    const { limits, signal } = out;

    const keys = Object.keys(req.options ?? {});
    if (keys.length)
        throw new ScoutError("OPTIONS",
            `The simulator takes no scan options, but was given ${keys.join(", ")}`);
    if (req.folder_id != null && req.folder_id !== req.root)
        throw new ScoutError("OPTIONS",
            `folder_id ${req.folder_id} is not the folder at root ${req.root}`);

    const { kids, items } = build_tree({ cassette, player, samples: limits.samples, log });

    let start = null;
    if (req.root != null) {
        if (!cassette)
            throw new ScoutError("OPTIONS",
                `No cassette is loaded, so there is no folder ${req.root}`);
        if (!kids.has(req.root))
            throw new ScoutError("OPTIONS",
                `Root ${req.root} is not a folder of the loaded cassette`);
        start = req.root;
    }

    /* The whole tree is in memory, so there are no requests to a
     * device to pace. Items still go out in batches, so data messages
     * go out between them. */
    let batch = [];
    const flush = async () => {
        if (batch.length) await out.add(batch);
        batch = [];
    };
    const add = async item => {
        batch.push(item);
        if (batch.length >= BATCH) await flush();
    };

    if (req.folder_id != null)
        await add(items.get(start));

    /* Breadth first, so a parent is always listed before its
     * children. */
    let depth_cut = false;
    const queue = [[start, 0]];
    for (let next = 0; next < queue.length && !signal.aborted; next++) {
        const [id, depth] = queue[next];
        for (const item of kids.get(id)) {
            const children = kids.get(item.id);
            if (item.kind == "folder" && children.length && depth + 1 >= limits.depth) {
                depth_cut = true;
                await add({ ...item, more: true });
                continue;
            }
            await add(item);
            if (item.kind == "folder")
                queue.push([item.id, depth + 1]);
        }
        out.progress({ visited: next + 1, note: id ?? "top" });
    }
    await flush();

    return {
        exhaustive: true,
        truncated:  depth_cut,
        reason:     depth_cut ? "depth" : null,
        excluded:   [],
    };
}
