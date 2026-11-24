/*
 * ACS service setup
 * Remove the retired Dataset maker role
 * Copyright 2026 University of Sheffield AMRC
 */

import { ServiceError } from "@amrc-factoryplus/service-client";

import { DataAccess } from "./uuids.js";

/* The Dataset maker role is gone: anyone makes datasets from the
 * sources they hold permission on, and everyone.yaml lets them manage
 * their own. No dump names the role any more, so nothing else removes
 * its grants. Remove them, empty the role, and delete it. Every step
 * is safe to repeat, and does nothing once the role has gone. */
export async function remove_dataset_maker (fplus) {
    const auth = fplus.Auth;
    const cdb = fplus.ConfigDB;
    const log = fplus.debug.bound("fixup");
    const role = DataAccess.Group.DatasetMaker;

    const grants = await auth.find_grants({ principal: role });
    for (const g of grants ?? []) {
        log("Deleting Dataset maker grant %s", g);
        await auth.delete_grant(g).catch(ServiceError.check(404));
    }

    const members = await cdb.class_direct_members(role)
        .catch(ServiceError.check(404));
    if (members == undefined) return;
    for (const m of members) {
        log("Removing %s from Dataset maker", m);
        await cdb.class_remove_member(role, m);
    }
    const subs = await cdb.class_direct_subclasses(role)
        .catch(ServiceError.check(404)) ?? [];
    for (const c of subs) {
        log("Removing subclass %s from Dataset maker", c);
        await cdb.class_remove_subclass(role, c);
    }

    log("Deleting the Dataset maker role");
    await cdb.delete_object(role).catch(ServiceError.check(404));
}
