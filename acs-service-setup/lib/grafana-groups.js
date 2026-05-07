/* ACS service setup
 * Provision Grafana role groups in F+.
 *
 * The pitch's Element 6: "Seed groups in service-setup for the
 * well-known Grafana roles so admins have something to grant against
 * on day one."
 *
 * Each group is a class in ConfigDB whose direct/recursive members are
 * principal UUIDs. Made a subclass of Class.Principal so the F+ Auth
 * service expands it as a principal-group during ACE evaluation, and so
 * a principal's membership shows up in the new
 * GET /v2/principal/{uuid}/groups endpoint and therefore in the
 * fp_groups JWT claim.
 *
 * Idempotent: existing objects are left in place (creation is best-effort,
 * the class_add_subclass call is a PUT which is idempotent).
 *
 * Copyright 2026 University of Sheffield AMRC
 */

import { UUIDs } from "@amrc-factoryplus/service-client";

export async function setup_grafana_groups (ss) {
    const { fplus } = ss;
    const cdb = fplus.ConfigDB;
    const log = fplus.debug.bound("grafana-groups");

    const groups = ss.config?.grafanaGroups;
    if (!groups) {
        log("No grafanaGroups configured; skipping seed");
        return;
    }

    for (const [role, uuid] of Object.entries(groups)) {
        const name = `Grafana ${role}`;
        log("Ensuring group %s (%s)", name, uuid);

        // create_object with an explicit UUID is idempotent: returns
        // the existing UUID if the object is already registered.
        await cdb.create_object(UUIDs.Class.R1Class, uuid);

        // PUT subclass relation - idempotent.
        await cdb.class_add_subclass(UUIDs.Class.Principal, uuid);

        // Set a human-readable name via the General Information app.
        await cdb.put_config(UUIDs.App.Info, uuid, { name });
    }
}
