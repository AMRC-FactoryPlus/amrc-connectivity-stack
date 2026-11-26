/*
 * ACS service setup
 * Tests for the Delete clusters permission and the grants it needs
 * Copyright 2026 University of Sheffield
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { UUIDs } from "@amrc-factoryplus/service-client";

import { DumpLoader } from "../lib/dumps.js";
import { ACS, Clusters, ConfigDB, Git, GatewayDepot } from "../lib/uuids.js";

const DUMPS = new URL("../dumps/", import.meta.url);

/* bin/check-yaml.js lints the dumps with these values. */
const ACS_CONFIG = {
    organisation:   "ORG",
    namespace:      "factory-plus",
    secure:         "s",
    domain:         "my.domain",
    k8sdomain:      "cluster.local",
    directory:      "https://directory.my.domain",
    realm:          "MY.DOMAIN",
};

const loader = new DumpLoader({
    dumps: [fileURLToPath(DUMPS)], acs_config: ACS_CONFIG,
    local: s => s, log: () => {},
});

function docs (file, service) {
    const text = fs.readFileSync(new URL(file, DUMPS), "utf8");
    return loader.parse_yaml(text, file).filter(d => d.service == service);
}

function grants_of (file, principal) {
    return Object.assign({}, ...docs(file, UUIDs.Service.Authentication)
        .map(d => d.grants?.[principal] ?? {}));
}

describe("Delete clusters permission", () => {
    test("is in the Cluster Manager's permission group", () => {
        const perms = Object.assign({}, ...docs("clusters.yaml", UUIDs.Service.ConfigDB)
            .map(d => d.objects?.[Clusters.Perm.All] ?? {}));
        assert.equal(perms[Clusters.Perm.DeleteClusters]?.name, "Delete clusters");
    });

    test("administrators hold that group, so they get it on upgrade", () => {
        assert.equal(ACS.PermGroup.Clusters, Clusters.Perm.All);
        const grants = grants_of("admin.yaml", ACS.Group.Administrator);
        assert.ok(ACS.PermGroup.Clusters in grants);
    });

    test("the Gateway Depot is not given it", () => {
        const grants = grants_of("gateway-depot.yaml",
            GatewayDepot.Requirement.ServiceAccount);
        assert.ok(Clusters.Perm.Clusters in grants);
        assert.ok(!(Clusters.Perm.DeleteClusters in grants));
        assert.ok(!(Clusters.Perm.All in grants));
    });
});

describe("Cluster Manager grants for deleting a cluster", () => {
    const grants = grants_of("clusters.yaml", Clusters.Requirement.ServiceAccount);

    test("may delete the cluster, its deployments and its accounts", () => {
        const del = grants[ConfigDB.Perm.DeleteObject];
        for (const klass of [Clusters.Class.Cluster, ACS.Class.EdgeDeployment,
                Clusters.Class.Account, "Local.Role.EdgeSync", "Local.Role.EdgeMonitor"])
            assert.equal(del?.[klass], true, klass);
    });

    test("may remove the cluster config and the repo", () => {
        assert.equal(grants[ConfigDB.Perm.WriteConfig]?.[Clusters.App.Cluster], false);
        assert.equal(grants[Git.Perm.Manage_Storage]?.[UUIDs.Special.Null], false);
    });
});
