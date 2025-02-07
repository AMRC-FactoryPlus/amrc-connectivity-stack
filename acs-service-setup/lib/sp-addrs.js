/* ACS service setup
 * Set up fixed Sparkplug addresses
 * Copyright 2025 University of Sheffield AMRC
 */

import { UUIDs } from "@amrc-factoryplus/service-client";

import { ACS } from "./uuids.js";

/* XXX This should not be needed. Some of the early services have fixed
 * UUIDs but use Sparkplug addresses with a variable org prefix. We
 * cannot handle that in the dumps. Properly these should be migrated to
 * dynamic accounts created by krbkeys, but this is core infrastructure
 * so I'm being cautious. Possibly these Sparkplug interfaces will
 * disappear altogether in favour of notify/v2 WS interfaces. */

export async function service_sp_addrs (ss) {
    const cdb = ss.fplus.ConfigDB;
    const org = ss.acs_config.organisation;
    const SA = ACS.ServiceAccount;

    const group_id = `${org}-Service-Core`;
    const addrs = [
        [SA.Directory,  "Directory"],
        [SA.ConfigDB,   "ConfigDB"],
        [SA.CmdEsc,     "Command_Escalation"],
    ];

    for (const [uuid, node_id] of addrs) {
        await cdb.put_config(UUIDs.App.SparkplugAddress, uuid,
            { group_id, node_id });
    }
}
