/*
 * ACS Admin
 * Answer "may the logged-in user do this?" from their own ACL
 * Copyright 2026 University of Sheffield
 *
 * The ACL comes from Auth's v2/whoami/acl. Auth has already expanded
 * groups, composite permissions and plural (class) grants, so a
 * check is a lookup of (permission, target). Anything the ACL cannot
 * show (server-side state, ownership) is left to the server: these
 * checks only hide controls that would certainly be refused.
 */

import { ConfigDB, WILDCARD } from "./perms.js";

/** The states an access checker can be in.
 * - loading: we don't know yet, so show nothing that changes things.
 * - ready: we have the user's ACL.
 * - unknown: Auth is too old to tell us, so show everything as before.
 */
export const Status = {
    Loading:    "loading",
    Ready:      "ready",
    Unknown:    "unknown",
};

/** Build a checker from the response of v2/whoami/acl.
 * @param {object} opts
 * @param {string} opts.status One of Status.
 * @param {boolean} [opts.root] The user is Auth's root principal.
 * @param {Array} [opts.acl] Entries of {permission, target}.
 */
export function make_checker (opts) {
    const status = opts.status;
    const root = !!opts.root;

    const by_perm = new Map();
    for (const { permission, target } of opts.acl ?? []) {
        if (!by_perm.has(permission)) by_perm.set(permission, new Set());
        by_perm.get(permission).add(target);
    }

    const open = status == Status.Unknown || root;

    /* A grant on this exact target, or on the wildcard. */
    const can = (permission, target) => {
        if (open) return true;
        if (status != Status.Ready) return false;
        const targs = by_perm.get(permission);
        return !!targs && (targs.has(target) || targs.has(WILDCARD));
    };

    /* A grant on any target at all. Use this where the target is not
     * known until the user picks it in the dialog the control opens. */
    const can_any = permission => {
        if (open) return true;
        if (status != Status.Ready) return false;
        return !!by_perm.get(permission)?.size;
    };

    /* A grant on the literal wildcard. Some services accept nothing
     * else (Files upload, Gateway Depot, user admin). */
    const can_wild = permission => {
        if (open) return true;
        if (status != Status.Ready) return false;
        return !!by_perm.get(permission)?.has(WILDCARD);
    };

    /* Every [permission, target] pair is granted. A null target means
     * any target. */
    const can_all = pairs => pairs.every(([p, t]) =>
        t == null ? can_any(p) : can(p, t));

    /* Common ConfigDB shapes. */
    const write_apps = (...apps) => apps.every(a => can(ConfigDB.WriteApp, a));
    /* PATCH needs read as well as write. */
    const patch_app = app => can(ConfigDB.ReadApp, app) && can(ConfigDB.WriteApp, app);
    /* Creating an object is checked against its class. */
    const create_in = klass =>
        can(ConfigDB.CreateObj, klass) || can(ConfigDB.CreateSpecificObj, klass);
    const delete_obj = obj => can(ConfigDB.DeleteObj, obj);

    return {
        status, root, can, can_any, can_wild, can_all,
        write_apps, patch_app, create_in, delete_obj,
    };
}
