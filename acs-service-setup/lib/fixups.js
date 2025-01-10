/* ACS service setup
 * Fixups from old configurations
 * Copyright 2023 AMRC
 */

import { UUIDs } from "@amrc-factoryplus/service-client";

import { ACS, Clusters, Fixup } from "./uuids.js";

/* This file is currently redundant; it did migrations needed when
 * upgrading ACS v2 -> v3. These have now been removed; we do not
 * support skipping major versions. I am keeping the file, as we will
 * probably need more fixups in the future... */

export async function fixups (ss) {
    const { fplus } = ss;

    return;
}

/* Previously Sparkplug Nodes were granted Role: Edge Node as a
 * permission targetting their own UUID. This worked only because that
 * permission group only contained permissions that either wanted that
 * target or ignored their target. Instead, move Edge Nodes into a user
 * group, and grant that group permission (in the dumps) to publish as
 * itself; this relies on the new Special.Self UUID. */
async function fixup_sparkplug_nodes (auth) {
    const aces = await auth.get_all_ace();
    const nodes = aces
        .filter(a => 
            a.permission == Fixup.Role.EdgeNode &&
            a.principal == a.target)
        .map(a => a.principal);

    for (const node of nodes) {
        await auth.add_to_group(ACS.Group.SparkplugNode, node);
        await auth.delete_ace(node, Fixup.Role.EdgeNode, node);
    }
}

async function remove_old_accounts (cdb, auth) {
    const accs = [
        [Fixup.User.Administrator, 
            ACS.Group.Administrator],
        [Fixup.User.ClusterManager, 
            Clusters.Requirement.ServiceAccount],
    ];

    for (const [acc, ...grps] of accs) {
        await auth.delete_principal(acc);
        for (const grp of grps)
            await auth.remove_from_group(grp, acc)
                .catch(() => null);
        await cdb.mark_object_deleted(acc)
            .catch(() => null);
    }
}
