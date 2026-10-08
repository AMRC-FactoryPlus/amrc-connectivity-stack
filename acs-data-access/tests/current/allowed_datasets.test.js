/*
 * ACS Data Access Service
 * Unit tests for which datasets a principal's lists include.
 *
 * Auth lets the root principal and wildcard grants through every single
 * check, so a principal like that could create a dataset and then not
 * find it in any list. These tests pin the lists to the same rules.
 * They run against fakes, so they need no cluster.
 */

import { Map as IMap } from "immutable";
import * as rx from "rxjs";
import { describe, expect, test } from "vitest";

import { UUIDs } from "@amrc-factoryplus/rx-client";
import { DataFlow } from "../../lib/dataflow.js";

const READ = "ec48462e-37eb-4f56-8efa-83d813e85559";
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const ROOT = "root@EXAMPLE.ORG";

/* A fake Auth: `acls` maps a principal to its grant targets for READ. */
function fake_auth(acls) {
  return {
    root_principal: ROOT,
    watch_acl_with_perm(principal, permission) {
      const targets = permission == READ ? acls[principal] ?? [] : [];
      return rx.of(new Set(targets));
    },
  };
}

async function listed(acls, principal) {
  const flow = Object.create(DataFlow.prototype);
  flow.auth = fake_auth(acls);
  const datasets = IMap({ [A]: { structure: "s" }, [B]: { structure: "s" } });
  const out = await rx.firstValueFrom(
    rx.of(datasets).pipe(flow.filter_allowed_datasets(principal, READ)));
  return [...out.keys()].sort();
}

describe("filter_allowed_datasets", () => {
  test("lists every dataset for the root principal, which has no grants", async () => {
    expect(await listed({}, ROOT)).toEqual([A, B]);
  });

  test("lists every dataset for a wildcard grant", async () => {
    expect(await listed({ "admin@EXAMPLE.ORG": [UUIDs.Special.Null] }, "admin@EXAMPLE.ORG"))
      .toEqual([A, B]);
  });

  test("lists only the granted datasets otherwise", async () => {
    expect(await listed({ "user@EXAMPLE.ORG": [B] }, "user@EXAMPLE.ORG")).toEqual([B]);
  });

  test("lists nothing without a grant", async () => {
    expect(await listed({}, "user@EXAMPLE.ORG")).toEqual([]);
  });
});
