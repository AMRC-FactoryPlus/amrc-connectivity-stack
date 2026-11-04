/*
 * ACS ISA-95 placement watcher
 * Render placements into Edge Agent configs
 * Copyright 2026 University of Sheffield AMRC
 *
 * Each device's ISA-95 placement lives in the ISA-95 Placement app.
 * This watches the placements and the vocabulary through ConfigDB
 * change notifications, renders every placement, and whenever a
 * device's rendering changes patches only that device's hierarchy
 * tags in its node's Edge Agent config. A vocabulary rename changes
 * the rendering of every device placed at or under the renamed node,
 * so those devices are patched too.
 *
 * The device's entry in the Edge Agent config is found by its
 * Instance_UUID tag, never by name. Writes use If-Match and are
 * retried when someone else wrote first.
 */

import * as rx from "rxjs";

import {
    ServiceError, UUIDs,
    isa95_vocabulary, patch_isa95, render_isa95,
} from "@amrc-factoryplus/service-client";

import { LevelClass } from "./constants.js";

const { App } = UUIDs;

/** The vocabulary nodes, from ConfigDB change notifications.
 * Emits an array of `{ uuid, name, level, aliases, children }` each
 * time the vocabulary, a level's members or a node's name changes. A
 * node with no name yet is left out, so nothing renders with a UUID
 * where a name should be.
 * @arg cdb An rx-client ConfigDB interface.
 */
export function vocabulary_feed (cdb) {
    const levels = Object.entries(LevelClass);
    return rx.combineLatest({
        members: rx.combineLatest(levels.map(([, k]) => cdb.watch_members(k))),
        vocab: cdb.search_app(App.ISA95Vocabulary),
    }).pipe(
        rx.switchMap(({ members, vocab }) => {
            const nodes = levels.flatMap(([level], i) =>
                [...(members[i] ?? [])].map(uuid => ({ uuid, level })));
            if (!nodes.length) return rx.of([]);
            return rx.combineLatest(nodes.map(n =>
                cdb.watch_config(App.Info, n.uuid))).pipe(
                rx.map(infos => nodes
                    .map((n, i) => {
                        const v = vocab.get(n.uuid) ?? {};
                        return {
                            ...n,
                            name:       infos[i]?.name,
                            aliases:    v.aliases ?? [],
                            children:   v.children ?? [],
                        };
                    })
                    .filter(n => typeof n.name == "string" && n.name != "")));
        }));
}

/** The placements, as a Map from device UUID to placement config.
 * @arg cdb An rx-client ConfigDB interface.
 */
export function placement_feed (cdb) {
    return cdb.search_app(App.ISA95Placement).pipe(
        rx.map(m => new Map(m.entries())));
}

/* A string that changes exactly when a rendering would change the
 * tags. */
function render_key (r) {
    return r.error ? `error:${r.error}` : JSON.stringify([r.tags, r.stamp]);
}

/** Work out which devices to patch.
 * @arg prev The renderings from last time, Map device -> rendering.
 * @arg next The renderings now.
 * @returns An array of `{ device, rendered }`; `rendered` is null for a
 * device whose placement was removed. Devices whose placement does not
 * render are not included: their tags are left as they are.
 */
export function changed_devices (prev, next) {
    const out = [];
    for (const [device, r] of next) {
        if (r.error) continue;
        const old = prev.get(device);
        if (!old || render_key(old) != render_key(r))
            out.push({ device, rendered: r });
    }
    for (const device of prev.keys())
        if (!next.has(device))
            out.push({ device, rendered: null });
    return out;
}

export class PlacementWatcher {
    /** Construct the watcher.
     * @arg opts.fplus An RxClient. Not needed when the other options
     * are given.
     * @arg opts.cdb A ConfigDB interface for reads and writes. It must
     * not cache.
     * @arg opts.placements An Observable of Maps, as `placement_feed`.
     * @arg opts.vocabulary An Observable of node arrays, as
     * `vocabulary_feed`.
     */
    constructor (opts) {
        const { fplus } = opts;

        this.cdb = opts.cdb ?? fplus.uncached().ConfigDB;
        this.placements = opts.placements ?? placement_feed(fplus.ConfigDB);
        this.vocabulary = opts.vocabulary ?? vocabulary_feed(fplus.ConfigDB);
        this.log = opts.log ?? fplus.debug.bound("watcher");
        this.debounce = opts.debounce ?? 500;
        this.attempts = opts.attempts ?? 5;
        this.retry_delay = opts.retry_delay ?? 5000;
    }

    /** The rendering of every placement, each time anything changes.
     * Emits a Map from device UUID to the result of `render_isa95`. */
    renderings () {
        return rx.combineLatest({
            placements: this.placements,
            nodes:      this.vocabulary,
        }).pipe(
            rx.debounceTime(this.debounce),
            rx.map(({ placements, nodes }) => {
                const vocab = isa95_vocabulary(nodes);
                return new Map([...placements].map(([device, p]) =>
                    [device, render_isa95(p, vocab, device)]));
            }));
    }

    /** The patches to make, one at a time. The first rendering patches
     * every placed device, which repairs anything missed while the
     * watcher was not running. */
    jobs () {
        return this.renderings().pipe(
            rx.startWith(new Map()),
            rx.pairwise(),
            rx.tap(([prev, next]) => {
                for (const [device, r] of next) {
                    const old = prev.get(device);
                    if (r.error && (!old || render_key(old) != render_key(r)))
                        this.log("Can't render the placement of %s: %s", device, r.error);
                }
            }),
            rx.mergeMap(([prev, next]) => changed_devices(prev, next)));
    }

    run () {
        this.subscription = this.jobs().pipe(
            rx.concatMap(job => this.apply(job)),
        ).subscribe({
            error: e => {
                this.log("Placement watcher failed: %s", e);
                process.exit(1);
            },
        });
        this.log("Watching ISA-95 placements");
        return this;
    }

    stop () {
        this.subscription?.unsubscribe();
    }

    /** Patch one device's hierarchy tags. Never throws. */
    async apply ({ device, rendered }) {
        for (let i = 1; i <= this.attempts; i++) {
            try {
                return await this.patch(device, rendered);
            }
            catch (e) {
                const stale = e instanceof ServiceError && e.status == 412;
                if (i == this.attempts) {
                    this.log("Giving up on %s after %d attempts: %s", device, i, e);
                    return "failed";
                }
                if (stale) {
                    this.log("Edge Agent config for %s changed under us; retrying", device);
                    continue;
                }
                this.log("Patching %s failed, retrying: %s", device, e);
                await new Promise(r => setTimeout(r, this.retry_delay));
            }
        }
    }

    /* One attempt. Returns what happened. */
    async patch (device, rendered) {
        const { cdb } = this;

        const info = await cdb.get_config(App.DeviceInformation, device);
        const node = info?.node;
        if (!node) {
            this.log("Device %s has no node; nothing to patch", device);
            return "no-node";
        }

        const [config, etag] = await cdb.get_config_with_etag(App.EdgeAgentConfig, node);
        if (!config) {
            this.log("Node %s of device %s has no Edge Agent config", node, device);
            return "no-config";
        }

        const { found, changed, config: next } = patch_isa95(config, device, rendered);
        if (!found) {
            this.log("Device %s has no entry with an Instance_UUID tag in the config of node %s; skipped",
                device, node);
            return "no-entry";
        }
        if (!changed) return "unchanged";

        await cdb.put_config(App.EdgeAgentConfig, node, next, { etag });
        this.log("Patched the ISA-95 hierarchy of %s on node %s: %s", device, node,
            rendered ? rendered.segments.join("/") : "removed");
        return "patched";
    }
}
