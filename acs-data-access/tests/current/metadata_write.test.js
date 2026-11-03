/*
 * ACS Data Access Service
 * Unit tests for the metadata write routes: name, tags, labels, kind
 * and run details.
 *
 * Each route checks EditDataset on the dataset and that the object is
 * a dataset before it writes anything. These run against fakes, so
 * they need no cluster.
 */

import { Map as IMap } from "immutable";
import * as rx from "rxjs";
import { describe, expect, test } from "vitest";

import { UUIDs } from "@amrc-factoryplus/rx-client";
import { ServiceError } from "@amrc-factoryplus/service-client";

import { APIv1 } from "../../lib/api-v1.js";
import { DataAccess as Constants } from "../../lib/constants.js";

const DATASET = "11111111-1111-1111-1111-111111111111";
const INVALID = "22222222-2222-2222-2222-222222222222";
const DEVICE = "33333333-3333-3333-3333-333333333333";

const datasets = {
  [DATASET]: { structure: Constants.App.SessionLimits, config: {} },
  [INVALID]: { structure: Constants.Special.InvalidDataset, config: null },
};

/* Builds an APIv1 wired to fakes. `denied` lists [permission, target]
 * pairs the fake ACL refuses. `configs` maps "app/uuid" to an entry,
 * and `members` maps a class to the set of its direct members. Every
 * ConfigDB write is recorded in order in `calls.writes`. */
function make_api({ denied = [], configs = {}, members = {} } = {}) {
  const calls = { writes: [] };
  const record = (...args) => calls.writes.push(args);
  const direct = klass => members[klass] ??= new Set();

  const cdb = {
    async get_config(app, uuid) { return configs[`${app}/${uuid}`]; },
    async put_config(app, uuid, config) { record("put", app, uuid, config); },
    async patch_config(app, uuid, type, patch) { record("patch", app, uuid, type, patch); },
    async delete_config(app, uuid) {
      if (!configs[`${app}/${uuid}`])
        throw new ServiceError(null, `Can't remove ${app} for ${uuid}`, 404);
      record("delete", app, uuid);
    },
    async class_has_member(klass, uuid) {
      return klass == Constants.Class.Dataset && uuid in datasets;
    },
    async class_has_direct_member(klass, uuid) { return direct(klass).has(uuid); },
    async class_add_member(klass, uuid) { record("add", klass, uuid); },
    async class_remove_member(klass, uuid) { record("remove", klass, uuid); },
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

function make_res() {
  return {
    code: null,
    status(code) { this.code = code; return this; },
    end() { return this; },
  };
}

const req = (uuid, body) => ({ params: { uuid }, auth: "tester", body });

describe("every metadata route checks the dataset first", () => {
  const routes = [
    ["metadata_put_name", { name: "Loom" }],
    ["metadata_put_tags", { tags: ["a"] }],
    ["metadata_put_labels", { labels: { [DEVICE]: "Energy" } }],
    ["metadata_put_kind", { kind: Constants.Kind.Run }],
    ["metadata_put_run", { operator: "A" }],
    ["metadata_patch_run", { note: "B" }],
  ];

  test.each(routes)("%s: 403 without EditDataset, nothing written", async (route, body) => {
    const { api, calls } = make_api({ denied: [[Constants.Perm.EditDataset, DATASET]] });
    await expect(api[route](req(DATASET, body), make_res()))
      .rejects.toMatchObject({ status: 403 });
    expect(calls.writes).toEqual([]);
  });

  test.each(routes)("%s: 404 for an object that is not a dataset", async (route, body) => {
    const { api, calls } = make_api();
    await expect(api[route](req(DEVICE, body), make_res()))
      .rejects.toMatchObject({ status: 404 });
    expect(calls.writes).toEqual([]);
  });

  test.each(routes)("%s: 422 for a bad UUID", async (route, body) => {
    const { api, calls } = make_api();
    await expect(api[route](req("not-a-uuid", body), make_res()))
      .rejects.toMatchObject({ status: 422 });
    expect(calls.writes).toEqual([]);
  });
});

describe("name", () => {
  test("keeps the other Info fields", async () => {
    const { api, calls } = make_api({
      configs: { [`${UUIDs.App.Info}/${DATASET}`]: { name: "Old", deleted: false } },
    });
    const res = make_res();
    await api.metadata_put_name(req(DATASET, { name: "  New  " }), res);
    expect(res.code).toBe(204);
    expect(calls.writes).toEqual([
      ["put", UUIDs.App.Info, DATASET, { name: "New", deleted: false }],
    ]);
  });

  test("writes nothing when the name is the same", async () => {
    const { api, calls } = make_api({
      configs: { [`${UUIDs.App.Info}/${DATASET}`]: { name: "Same" } },
    });
    await api.metadata_put_name(req(DATASET, { name: "Same" }), make_res());
    expect(calls.writes).toEqual([]);
  });

  test("an invalid dataset can still be renamed", async () => {
    const { api, calls } = make_api();
    await api.metadata_put_name(req(INVALID, { name: "Fix me" }), make_res());
    expect(calls.writes).toEqual([["put", UUIDs.App.Info, INVALID, { name: "Fix me" }]]);
  });

  test.each([[{}], [{ name: "  " }], [{ name: 3 }]])("refuses %o", async body => {
    const { api } = make_api();
    await expect(api.metadata_put_name(req(DATASET, body), make_res()))
      .rejects.toMatchObject({ status: 422 });
  });
});

describe("tags and labels", () => {
  test("tags are written", async () => {
    const { api, calls } = make_api();
    await api.metadata_put_tags(req(DATASET, { tags: ["a", "b"] }), make_res());
    expect(calls.writes).toEqual([["put", Constants.Metadata.Tags, DATASET, { tags: ["a", "b"] }]]);
  });

  test("no tags removes the entry, and a missing entry is fine", async () => {
    const { api, calls } = make_api({
      configs: { [`${Constants.Metadata.Tags}/${DATASET}`]: { tags: ["a"] } },
    });
    await api.metadata_put_tags(req(DATASET, { tags: [] }), make_res());
    await api.metadata_put_labels(req(DATASET, { labels: {} }), make_res());
    expect(calls.writes).toEqual([["delete", Constants.Metadata.Tags, DATASET]]);
  });

  test.each([[{ tags: "a" }], [{ tags: [1] }]])("tags refuse %o", async body => {
    const { api } = make_api();
    await expect(api.metadata_put_tags(req(DATASET, body), make_res()))
      .rejects.toMatchObject({ status: 422 });
  });

  test.each([[{ labels: [] }], [{ labels: { x: 1 } }], [{}]])("labels refuse %o", async body => {
    const { api } = make_api();
    await expect(api.metadata_put_labels(req(DATASET, body), make_res()))
      .rejects.toMatchObject({ status: 422 });
  });
});

describe("kind", () => {
  test("moves the dataset from its old kind to the new one", async () => {
    const { api, calls } = make_api({
      members: { [Constants.Kind.Equipment]: new Set([DATASET]) },
    });
    await api.metadata_put_kind(req(DATASET, { kind: Constants.Kind.Run }), make_res());
    expect(calls.writes).toEqual([
      ["remove", Constants.Kind.Equipment, DATASET],
      ["add", Constants.Kind.Run, DATASET],
    ]);
  });

  test("the same kind writes nothing", async () => {
    const { api, calls } = make_api({
      members: { [Constants.Kind.Run]: new Set([DATASET]) },
    });
    await api.metadata_put_kind(req(DATASET, { kind: Constants.Kind.Run }), make_res());
    expect(calls.writes).toEqual([]);
  });

  test("null removes every kind", async () => {
    const { api, calls } = make_api({
      members: { [Constants.Kind.Product]: new Set([DATASET]) },
    });
    await api.metadata_put_kind(req(DATASET, { kind: null }), make_res());
    expect(calls.writes).toEqual([["remove", Constants.Kind.Product, DATASET]]);
  });

  test("refuses a class that is not a kind", async () => {
    const { api, calls } = make_api();
    await expect(api.metadata_put_kind(req(DATASET, { kind: Constants.Class.Published }), make_res()))
      .rejects.toMatchObject({ status: 422 });
    await expect(api.metadata_put_kind(req(DATASET, {}), make_res()))
      .rejects.toMatchObject({ status: 422 });
    expect(calls.writes).toEqual([]);
  });
});

describe("run details", () => {
  test("PUT replaces the entry", async () => {
    const { api, calls } = make_api();
    await api.metadata_put_run(req(DATASET, { operator: "A" }), make_res());
    expect(calls.writes).toEqual([["put", Constants.Metadata.RunMetadata, DATASET, { operator: "A" }]]);
  });

  test("PATCH sends a merge patch", async () => {
    const { api, calls } = make_api();
    await api.metadata_patch_run(req(DATASET, { void: null }), make_res());
    expect(calls.writes).toEqual([["patch", Constants.Metadata.RunMetadata, DATASET, "merge", { void: null }]]);
  });

  test.each([["metadata_put_run"], ["metadata_patch_run"]])("%s refuses a list", async route => {
    const { api } = make_api();
    await expect(api[route](req(DATASET, []), make_res()))
      .rejects.toMatchObject({ status: 422 });
  });
});
