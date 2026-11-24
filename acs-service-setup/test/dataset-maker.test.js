/*
 * ACS service setup
 * Tests for removing the Dataset maker role, and for the grants to
 * every principal
 * Copyright 2026 University of Sheffield AMRC
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { ServiceError, UUIDs } from "@amrc-factoryplus/service-client";

import { DumpLoader } from "../lib/dumps.js";
import { remove_dataset_maker } from "../lib/remove-dataset-maker.js";
import { Auth, DataAccess } from "../lib/uuids.js";

const ROLE = DataAccess.Group.DatasetMaker;
const PAT = "6c3a4a6e-0d1c-4f0a-9d6c-7a2f8e1b3c4d";
const TEAM = "2b8e5f7a-3c9d-4e1f-8a6b-5d4c3b2a1f0e";

const not_found = () => new ServiceError(null, "not found", 404);

/* Just the Auth and ConfigDB calls the fixup makes. `exists` false is
 * a cluster where the role has already gone: ConfigDB answers 404. */
function fakes ({ exists = true } = {}) {
    const grants = new Map([
        ["g1", { principal: ROLE }],
        ["g2", { principal: ROLE }],
        ["g3", { principal: PAT }],
    ]);
    const members = new Set(exists ? [PAT] : []);
    const subs = new Set(exists ? [TEAM] : []);
    const calls = [];
    let present = exists;

    const fplus = {
        debug: { bound: () => () => {} },
        Auth: {
            find_grants: async ({ principal }) => [...grants]
                .filter(([, g]) => g.principal == principal)
                .map(([id]) => id),
            delete_grant: async id => {
                calls.push(["delete_grant", id]);
                grants.delete(id);
            },
        },
        ConfigDB: {
            class_direct_members: async k => {
                if (!present) throw not_found();
                return [...members];
            },
            class_direct_subclasses: async k => {
                if (!present) throw not_found();
                return [...subs];
            },
            class_remove_member: async (k, m) => {
                calls.push(["remove_member", k, m]);
                members.delete(m);
            },
            class_remove_subclass: async (k, c) => {
                calls.push(["remove_subclass", k, c]);
                subs.delete(c);
            },
            /* Like ConfigDB, refuse to delete a class with members or
             * subclasses. */
            delete_object: async o => {
                if (!present) throw not_found();
                if (members.size || subs.size)
                    throw new ServiceError(null, "in use", 409);
                calls.push(["delete_object", o]);
                present = false;
            },
        },
    };
    return { fplus, grants, calls };
}

describe("remove_dataset_maker", () => {
    test("removes the role's grants, empties it and deletes it", async () => {
        const { fplus, grants, calls } = fakes();
        await remove_dataset_maker(fplus);

        assert.deepEqual([...grants.keys()], ["g3"]);
        assert.deepEqual(calls, [
            ["delete_grant", "g1"],
            ["delete_grant", "g2"],
            ["remove_member", ROLE, PAT],
            ["remove_subclass", ROLE, TEAM],
            ["delete_object", ROLE],
        ]);
    });

    test("a second run does nothing", async () => {
        const { fplus, calls } = fakes();
        await remove_dataset_maker(fplus);
        calls.length = 0;
        await remove_dataset_maker(fplus);

        assert.deepEqual(calls, []);
    });

    test("a cluster that never had the role is left alone", async () => {
        const { fplus, calls } = fakes({ exists: false });
        await remove_dataset_maker(fplus);

        assert.deepEqual(calls, [
            ["delete_grant", "g1"],
            ["delete_grant", "g2"],
        ]);
    });
});

describe("dumps", () => {
    /* helm.yaml reads the site's settings; any value will do here. */
    const acs_config = new Proxy({}, { has: () => true, get: () => "x" });
    const loader = new DumpLoader({
        dumps: [], acs_config, local: s => s, log: () => {},
    });
    const dir = new URL("../dumps/", import.meta.url);
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".yaml"));
    const auth_grants = f => loader
        .parse_yaml(fs.readFileSync(new URL(f, dir), "utf8"), f)
        .filter(d => d.service == UUIDs.Service.Authentication)
        .map(d => d.grants ?? {});

    /* A dump load replaces every grant of the principals it names, so
     * two files granting to the Principal class remove each other's. */
    test("only everyone.yaml grants to every principal", () => {
        const granting = files.filter(f => auth_grants(f)
            .some(g => Auth.Class.Principal in g));
        assert.deepEqual(granting, ["everyone.yaml"]);
    });

    test("no dump grants to Dataset maker", () => {
        const granting = files.filter(f => auth_grants(f)
            .some(g => ROLE in g));
        assert.deepEqual(granting, []);
    });

    test("everyone may manage only their own datasets", () => {
        const [grants] = auth_grants("everyone.yaml");
        const mine = grants[Auth.Class.Principal];
        for (const p of ["ReadDataset", "IncludeInUnion", "UseForSession",
                "EditDataset", "DeleteDataset"])
            assert.deepEqual(mine[DataAccess.Perm[p]],
                { [UUIDs.Special.Mine]: true }, p);
        assert.equal(mine[DataAccess.Perm.CreateDataset], undefined);
        assert.equal(mine[DataAccess.Perm.UseDevice], undefined);
    });
});
