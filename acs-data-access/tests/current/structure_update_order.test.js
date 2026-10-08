/*
 * ACS Data Access Service
 * Unit tests for the order of checks and writes in structure_update.
 *
 * A rejected update must leave the dataset as it was. These run against
 * fakes, so they need no cluster.
 */

import { Map as IMap } from "immutable";
import * as rx from "rxjs";
import { describe, expect, test } from "vitest";

import { ServiceError } from "@amrc-factoryplus/service-client";

import { APIv1 } from "../../lib/api-v1.js";
import { DataAccess as Constants } from "../../lib/constants.js";

const SRC_A = "11111111-1111-1111-1111-111111111111";
const SRC_B = "22222222-2222-2222-2222-222222222222";
const SRC_C = "66666666-6666-6666-6666-666666666666";
const UNION = "33333333-3333-3333-3333-333333333333";
const SESSION = "44444444-4444-4444-4444-444444444444";

const FROM = "2025-01-01T00:00:00.000Z";
const TO = "2025-01-02T00:00:00.000Z";

/* Builds an APIv1 wired to fakes.
 *
 * `datasets` maps a dataset UUID to { structure, config }, the same shape
 * DataFlow produces. `denied` lists [permission, target] pairs that the
 * fake ACL refuses; everything else is allowed. `delete_errors` maps a
 * structure app to the HTTP status that the fake delete_config fails
 * with for it. Every ConfigDB write is recorded in order in `calls.writes`.
 */
function make_api(datasets, denied = [], delete_errors = {}) {
  const calls = { writes: [] };
  const record = (...args) => calls.writes.push(args);

  const cdb = {
    async class_add_subclass(klass, sub) { record("add_subclass", klass, sub); },
    async class_remove_subclass(klass, sub) { record("remove_subclass", klass, sub); },
    async put_config(app, uuid, config) { record("put_config", app, uuid, config); },
    async delete_config(app, uuid) {
      const status = delete_errors[app];
      if (status)
        throw new ServiceError(null, `Can't remove ${app} for ${uuid}`, status);
      record("delete_config", app, uuid);
    },
    async create_object() { throw new Error("create_object not expected"); },
  };

  const auth = {
    async check_acl(principal, perm, target) {
      return !denied.some(([p, t]) => p === perm && t === target);
    },
  };

  const api = new APIv1({
    data: {
      datasets: rx.of(IMap(datasets)),
      allowed_all_datasets: () => rx.of(IMap(datasets)),
    },
    auth,
    cdb,
    debug: { bound: () => () => {} },
    influxReader: {},
  });

  return { api, calls };
}

/* Minimal express response double. */
function make_res() {
  return {
    code: null,
    body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function make_req(uuid, structure, config) {
  return { params: { uuid }, auth: "tester", body: { structure, config } };
}

const union_dataset = {
  [UNION]: {
    structure: Constants.App.UnionComponents,
    config: [SRC_A, SRC_B],
  },
};

const session_dataset = {
  [SESSION]: {
    structure: Constants.App.SessionLimits,
    config: { source: SRC_A, from: FROM, to: TO },
  },
};

/* DataFlow reports a dataset with two structural definitions as invalid,
 * with a null config. */
const invalid_dataset = {
  [UNION]: {
    structure: Constants.Special.InvalidDataset,
    config: null,
  },
};

describe("structure_update rejects before it removes anything", () => {
  test("union: missing source permission leaves the old links", async () => {
    const { api, calls } = make_api(union_dataset, [
      [Constants.Perm.IncludeInUnion, SRC_C],
    ]);

    await expect(api.structure_update(
      make_req(UNION, Constants.App.UnionComponents, [SRC_A, SRC_C]),
      make_res(),
    )).rejects.toMatchObject({ status: 403 });

    expect(calls.writes).toEqual([]);
  });

  test("union: invalid config leaves the old links", async () => {
    const { api, calls } = make_api(union_dataset);

    await expect(api.structure_update(
      make_req(UNION, Constants.App.UnionComponents, [SRC_A, "not-a-uuid"]),
      make_res(),
    )).rejects.toMatchObject({ status: 422 });

    expect(calls.writes).toEqual([]);
  });

  test("session: missing source permission leaves the old link", async () => {
    const { api, calls } = make_api(session_dataset, [
      [Constants.Perm.UseForSession, SRC_B],
    ]);

    await expect(api.structure_update(
      make_req(SESSION, Constants.App.SessionLimits,
        { source: SRC_B, from: FROM, to: TO }),
      make_res(),
    )).rejects.toMatchObject({ status: 403 });

    expect(calls.writes).toEqual([]);
  });

  test("invalid dataset: missing source permission keeps its config entries", async () => {
    const { api, calls } = make_api(invalid_dataset, [
      [Constants.Perm.IncludeInUnion, SRC_C],
    ]);

    await expect(api.structure_update(
      make_req(UNION, Constants.App.UnionComponents, [SRC_C]),
      make_res(),
    )).rejects.toMatchObject({ status: 403 });

    expect(calls.writes).toEqual([]);
  });

  test("invalid dataset: invalid config keeps its config entries", async () => {
    const { api, calls } = make_api(invalid_dataset);

    await expect(api.structure_update(
      make_req(UNION, Constants.App.SessionLimits, { source: SRC_A }),
      make_res(),
    )).rejects.toMatchObject({ status: 422 });

    expect(calls.writes).toEqual([]);
  });

  test("changing structure type is refused without writes", async () => {
    const { api, calls } = make_api(union_dataset);

    await expect(api.structure_update(
      make_req(UNION, Constants.App.SessionLimits,
        { source: SRC_A, from: FROM, to: TO }),
      make_res(),
    )).rejects.toMatchObject({ status: 409 });

    expect(calls.writes).toEqual([]);
  });
});

describe("structure_update applies an accepted update", () => {
  test("union: replaces the old links with the new ones", async () => {
    const { api, calls } = make_api(union_dataset);

    const res = make_res();
    await api.structure_update(
      make_req(UNION, Constants.App.UnionComponents, [SRC_A, SRC_C]),
      res,
    );

    expect(res.code).toBe(200);
    expect(res.body).toBe(UNION);
    expect(calls.writes).toEqual([
      ["remove_subclass", UNION, SRC_A],
      ["remove_subclass", UNION, SRC_B],
      ["put_config", Constants.App.UnionComponents, UNION, [SRC_A, SRC_C]],
      ["add_subclass", UNION, SRC_A],
      ["add_subclass", UNION, SRC_C],
    ]);
  });

  test("session: moves the link to the new source", async () => {
    const { api, calls } = make_api(session_dataset);
    const config = { source: SRC_B, from: FROM, to: TO };

    const res = make_res();
    await api.structure_update(
      make_req(SESSION, Constants.App.SessionLimits, config),
      res,
    );

    expect(res.code).toBe(200);
    expect(calls.writes).toEqual([
      ["remove_subclass", SRC_A, SESSION],
      ["put_config", Constants.App.SessionLimits, SESSION, config],
      ["add_subclass", SRC_B, SESSION],
    ]);
  });

  test("invalid dataset: clears every structure, then writes the new config", async () => {
    const { api, calls } = make_api(invalid_dataset);

    const res = make_res();
    await api.structure_update(
      make_req(UNION, Constants.App.UnionComponents, [SRC_A]),
      res,
    );

    expect(res.code).toBe(200);

    const deletes = calls.writes.filter(w => w[0] === "delete_config");
    expect(deletes.map(w => w[1]).sort())
      .toEqual(Object.values(Constants.App).sort());

    expect(calls.writes.slice(deletes.length)).toEqual([
      ["put_config", Constants.App.UnionComponents, UNION, [SRC_A]],
      ["add_subclass", UNION, SRC_A],
    ]);
  });
});

describe("structure_update clean-up of an invalid dataset", () => {
  test("ignores a 404 for a structure with no entry", async () => {
    const { api, calls } = make_api(invalid_dataset, [], {
      [Constants.App.SessionLimits]: 404,
    });

    const res = make_res();
    await api.structure_update(
      make_req(UNION, Constants.App.UnionComponents, [SRC_A]),
      res,
    );

    expect(res.code).toBe(200);
    expect(calls.writes.at(-2))
      .toEqual(["put_config", Constants.App.UnionComponents, UNION, [SRC_A]]);
    expect(calls.writes.at(-1)).toEqual(["add_subclass", UNION, SRC_A]);
  });

  test("fails on any other error and writes nothing further", async () => {
    const { api, calls } = make_api(invalid_dataset, [], {
      [Constants.App.SessionLimits]: 503,
    });

    await expect(api.structure_update(
      make_req(UNION, Constants.App.UnionComponents, [SRC_A]),
      make_res(),
    )).rejects.toMatchObject({ status: 503 });

    expect(calls.writes.every(w => w[0] === "delete_config")).toBe(true);
  });
});
