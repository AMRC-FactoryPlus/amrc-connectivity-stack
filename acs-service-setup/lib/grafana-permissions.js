/* ACS service setup
 * Provision Grafana role permissions in F+.
 *
 * Each Grafana role (GrafanaAdmin, Admin, Editor) is a Permission
 * object in ConfigDB, granted to principals via the standard F+ ACL
 * editor with target=Wildcard. The SPI's fp_permissions JWT claim
 * surfaces these to Grafana, which maps them into roles via JMESPath.
 *
 * "Viewer" has no permission - it is the implicit fallback for any
 * authenticated user who holds none of the three role permissions.
 *
 * Idempotent: existing objects are left in place. UUIDs come from
 * values.yaml (serviceSetup.config.grafanaPermissions) so the chart
 * and service-setup stay in sync.
 *
 * Copyright 2026 University of Sheffield AMRC
 */

import { UUIDs } from "@amrc-factoryplus/service-client";

export async function setup_grafana_permissions (ss) {
    const { fplus } = ss;
    const cdb = fplus.ConfigDB;
    const log = fplus.debug.bound("grafana-permissions");

    const perms = ss.config?.grafanaPermissions;
    if (!perms) {
        log("No grafanaPermissions configured; skipping seed");
        return;
    }

    for (const [role, uuid] of Object.entries(perms)) {
        const name = `Grafana ${role}`;
        log("Ensuring permission %s (%s)", name, uuid);

        // create_object with an explicit UUID is idempotent.
        await cdb.create_object(UUIDs.Class.Permission, uuid);

        // Human-readable name via the General Information app.
        await cdb.put_config(UUIDs.App.Info, uuid, { name });
    }
}
