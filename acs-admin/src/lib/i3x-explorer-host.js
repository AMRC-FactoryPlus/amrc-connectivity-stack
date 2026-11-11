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
 * URL from the Directory and a Bearer token from the service client. */

import { UUIDs } from "@amrc-factoryplus/service-client";

export const HOST_KEY = "__acsI3xExplorerHost";

/* The i3X type of an ISA-95 level object. */
export const ISA95_LEVEL_TYPE = "isa95-level";

/**
 * Make the host object.
 *
 * @param opts.client      a promise for the service client, or the client
 * @param opts.theme       () => "light" | "dark"
 * @param opts.open_window () => void, opens the Explorer page in a new window
 * @param opts.selected    (selection | null) => void
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
        selected (selection) {
            opts.selected(selection ?? null);
        },
    };
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
