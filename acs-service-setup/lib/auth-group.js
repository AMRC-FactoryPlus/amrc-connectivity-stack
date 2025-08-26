/*
 * ACS service setup
 * Migrate Auth groups to the ConfigDB
 * Copyright 2025 University of Sheffield AMRC
 */

import { UUIDs } from "@amrc-factoryplus/service-client";

export async function migrate_auth_groups (ss) {
    const { fplus } = ss;

    const auth = fplus.Auth;
    const cdb = fplus.ConfigDB;
    const log = fplus.debug.bound("groups");

    /* This endpoint is not mapped in the ServiceClient */
    const [st, grps] = await auth.fetch("authz/group/all");
    if (st != 200)
        throw `Can't fetch legacy Auth groups: ${st}`;

    const uuids = new Set(grps.flatMap(m => [m.parent, m.child]));
    const reg = await Promise.all(
        [...uuids].map(u =>
            cdb.get_config(UUIDs.App.Registration, u)
                .then(r => [u, r])));
    const unreg = new Set(reg.filter(e => !e[1]));
    const rank = new Map(reg.filter(e => e[1]).map(([u, i]) => [u, i.rank]));

    /* XXX The list needs filtering to remove entries which will be
     * handled correctly in the dumps. We only need to forward-port
     * group entries made by local admins. */

    for (const { parent, child } of grps) {
        if (unreg.has(parent) || unreg.has(child)) {
            log("Can't migrate %s ∈ %s: unregistered object", child, parent);
            continue;
        }

        const clear = () => auth.fetch({
            method: "DELETE", 
            url:    `authz/group/${parent}/${child}`
        });
        const [pr, cr] = [parent, child].map(o => rank.get(o));
        if (pr == cr) {
            log("Migrating %s ⊂ %s", child, parent);
            await cdb.class_add_subclass(parent, child);
            await clear();
        }
        else if (pr == cr + 1) {
            log("Migrating %s ∈ %s", child, parent);
            await cdb.class_add_member(parent, child);
            await clear();
        }
        else {
            log("Can't migrate %s ∈ %s: rank mismatch", child, parent);
        }
    }
}
