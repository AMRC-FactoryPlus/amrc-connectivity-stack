/*
 * ACS Admin
 * The host the vendored i3X Explorer looks for when the Explorer page frames it
 * Copyright 2026 University of Sheffield
 */

/* The Explorer page shows the i3X Explorer (i3x-explorer/, built to
 * /i3x-explorer/) in a same-origin iframe. Before it creates the frame
 * it puts a host object on window under HOST_KEY; the app reads it
 * through window.parent (i3x-explorer/src/acs/host.ts holds the other
 * half). The host lends the app this console's session: the i3X service
 * URL from the Directory and a Bearer token from the service client, and
 * offers this console's own actions on the selected object (Manage
 * access, Build dataset), which the app shows as buttons beside its
 * Subscribe and hands back here to run. */

import { UUIDs } from "@amrc-factoryplus/service-client";

import { resolve_isa95 } from "@/lib/access/i3x-access.js";
import { default_dataset_uuid } from "@/lib/datasets/model.js";

export const HOST_KEY = "__acsI3xExplorerHost";

/* The i3X type of an ISA-95 level object. */
export const ISA95_LEVEL_TYPE = "isa95-level";

/**
 * Make the host object.
 *
 * @param opts.client      a promise for the service client, or the client
 * @param opts.theme       () => "light" | "dark"
 * @param opts.open_window () => void, opens the Explorer page in a new window
 * @param opts.actions     async (selection) => the explorer_actions() for
 *                         the app's selection ({ object, ancestors })
 * @param opts.run         (action, selection) => void, runs one of them
 * @param opts.location    () => { object, tab } the console's URL names
 * @param opts.set_location ({ object, tab }) => void, writes it to the URL
 * @param opts.on_location (go) => unregister: call go({ object, tab })
 *                         when the console's URL changes under the page
 */
export function mk_host (opts) {
    const client = () => Promise.resolve(opts.client);
    /* The i3X service URL, as the Directory gives it, without /v1. */
    const service = async () => (await client()).service_url(UUIDs.Service.i3x);

    return {
        async serviceUrl () {
            return new URL("v1", await service()).toString().replace(/\/$/, "");
        },
        /* `bad` is a token the service refused; the service client then
         * fetches a new one rather than handing back its cached copy. */
        async token (bad) {
            const fplus = await client();
            return fplus.Fetch.service_token(await service(), bad);
        },
        theme () {
            return opts.theme();
        },
        openNewWindow () {
            opts.open_window();
        },
        /* What the app shows: only plain { id, label } objects cross
         * into the frame. */
        async actions (selection) {
            const actions = await opts.actions(selection);
            return actions.map(a => ({ id: a.id, label: a.label }));
        },
        /* The actions are worked out again, so the app can only run one
         * this console offers on that object now. */
        async runAction (id, selection) {
            const action = (await opts.actions(selection)).find(a => a.id === id);
            if (action) opts.run(action, selection);
        },
        /* The app gives what opens its search, for ⌘K pressed outside
         * the frame. Returns a function that unregisters. */
        onSearchRequest (open) {
            return opts.on_search ? opts.on_search(open) : () => {};
        },
        /* Where the console's URL says the Explorer should be. */
        location () {
            return opts.location?.() ?? null;
        },
        /* The Explorer moved; only plain strings cross back. */
        setLocation (loc) {
            opts.set_location?.({
                object: typeof loc?.object === "string" ? loc.object : null,
                tab: typeof loc?.tab === "string" ? loc.tab : null,
            });
        },
        onLocationRequest (go) {
            return opts.on_location ? opts.on_location(go) : () => {};
        },
        /* Esc pressed in the frame that the app did not use itself, so
         * full screen can be left from inside the Explorer. */
        escape () {
            opts.escape?.();
        },
    };
}

/**
 * The Explorer location a route query names: { object, tab }, each a
 * string or null. Repeated keys take the first.
 */
export function query_location (query) {
    const one = v => {
        const x = Array.isArray(v) ? v[0] : v;
        return typeof x === "string" && x ? x : null;
    };
    return { object: one(query?.object), tab: one(query?.tab) };
}

/**
 * The route query for an Explorer location, keeping any other keys.
 * No object means neither key; a tab only goes with an object.
 */
export function location_query (loc, query = {}) {
    const { object: _o, tab: _t, ...rest } = query ?? {};
    if (!loc?.object) return rest;
    return { ...rest, object: loc.object, ...(loc.tab ? { tab: loc.tab } : {}) };
}

/* The ISA-95 level names from the top down to, and including, the last
 * of `chain` that is a level, stopping at the first object that is not
 * one. `chain` runs from the top of the tree down. */
function level_names (chain) {
    const names = [];
    for (const obj of chain) {
        if (obj.typeId !== ISA95_LEVEL_TYPE) break;
        names.push(obj.displayName);
    }
    return names;
}

/**
 * Say what the Explorer's selection is, for the actions the page offers
 * on it. A device is an object directly under an ISA-95 level; a level
 * is an ISA-95 level object. Anything else (a branch or a metric inside
 * a device) is read with its device, so it gets no access actions.
 *
 * @param selection { object, ancestors } from the Explorer, or null
 * @returns null, or { kind: "level" | "device" | "other", object,
 *          levels: names of the ISA-95 levels above a device or down to
 *          a level, top first }
 */
export function classify_selection (selection) {
    const object = selection?.object;
    if (!object) return null;
    const ancestors = selection.ancestors ?? [];
    const parent = ancestors.at(-1);

    if (object.typeId === ISA95_LEVEL_TYPE) {
        const chain = level_names([...ancestors, object]);
        /* A level under something that is not a level is not part of
         * the ISA-95 tree this console can grant on. */
        if (chain.length !== ancestors.length + 1)
            return { kind: "other", object, levels: [] };
        return { kind: "level", object, levels: chain };
    }
    if (parent?.typeId === ISA95_LEVEL_TYPE) {
        const chain = level_names(ancestors);
        if (chain.length === ancestors.length)
            return { kind: "device", object, levels: chain };
    }
    return { kind: "other", object, levels: [] };
}

/**
 * This console's actions on a classified selection, as the Explorer page
 * offered them above the frame. A device can have its i3X access managed
 * and a dataset built from it. An ISA-95 level can have its access managed
 * when every level name down to it matches the ISA-95 vocabulary, since
 * access is granted on the vocabulary node. Nothing else has either.
 *
 * @param selection classify_selection() of the Explorer's selection
 * @param isa95     the ISA-95 vocabulary nodes (useISA95Store().data)
 * @returns [{ id: "access", label, access: I3xAccessButton's props }
 *          | { id: "show-dataset" | "dataset", label, route }]
 */
export function explorer_actions (selection, isa95) {
    if (!selection) return [];
    const { kind, object, levels } = selection;
    const path = levels.join(" / ");
    const nodes = resolve_isa95(isa95 ?? [], levels);

    if (kind === "device") return [
        { id: "access", label: "Manage access", access: {
            target: object.elementId, device: true, via: nodes,
            noun: "device", name: object.displayName, path,
        } },
        /* The device's own dataset, which Data Access keeps for every
         * placed device under a UUID made from the device's. */
        { id: "show-dataset", label: "Show dataset", route: {
            path: `/datasets/${default_dataset_uuid(object.elementId)}`,
        } },
        { id: "dataset", label: "Build dataset", route: {
            path: "/datasets/new", query: { devices: object.elementId },
        } },
    ];

    if (kind === "level" && levels.length && nodes.length === levels.length) {
        const node = nodes.at(-1);
        return [
            { id: "access", label: "Manage access", access: {
                target: node.uuid, device: false, via: nodes.slice(0, -1),
                noun: (node.level ?? "level").toLowerCase(), name: node.name, path,
            } },
        ];
    }
    return [];
}
