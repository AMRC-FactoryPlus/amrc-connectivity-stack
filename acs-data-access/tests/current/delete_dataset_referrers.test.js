/*
 * ACS Data Access Service
 * Unit tests for the delete path's referential integrity check.
 *
 * These run against fakes, so they need no cluster.
 */

import { Map as IMap } from "immutable";
import * as rx from "rxjs";
import { describe, expect, test } from "vitest";

import { APIv1 } from "../../lib/api-v1.js";
import { DataAccess as Constants } from "../../lib/constants.js";

const SRC_A = "11111111-1111-1111-1111-111111111111";
const SRC_B = "22222222-2222-2222-2222-222222222222";
const UNION = "33333333-3333-3333-3333-333333333333";
const SESSION = "44444444-4444-4444-4444-444444444444";
const DEVICE = "55555555-5555-5555-5555-555555555555";

/* Builds an APIv1 wired to fakes.
 *
 * `datasets` maps a dataset UUID to { structure, config }, the same shape
 * DataFlow produces. The fake ConfigDB derives its per-app search results
 * from that map, so the tests only describe the graph once.
 */
function make_api(datasets, raw_configs) {
  const calls = {
    deleted: [],
    removed_subclasses: [],
  };

  const cdb = {
    search_app(app) {
      /* raw_configs lets a test give ConfigDB a config document that the
       * derived dataset map does not carry, which is what happens when a
       * dataset is invalid. */
      if (raw_configs)
        return rx.of(IMap(raw_configs[app] ?? {}));

      let configs = IMap();

      for (const [uuid, def] of Object.entries(datasets)) {
        if (def.structure === app && def.config != null)
          configs = configs.set(uuid, def.config);
      }

      return rx.of(configs);
    },

    async class_direct_subclasses() { return []; },

    async class_remove_subclass(klass, sub) {
      calls.removed_subclasses.push([klass, sub]);
    },

    async delete_object(uuid) { calls.deleted.push(uuid); },
  };

  const api = new APIv1({
    data: { datasets: rx.of(IMap(datasets)) },
    auth: { async check_acl() { return true; } },
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

function make_req(uuid) {
  return { params: { uuid }, auth: "tester" };
}

describe("delete_dataset referential integrity", () => {
  test("deletes a dataset with no referrers", async () => {
    const { api, calls } = make_api({
      [SRC_A]: {
        structure: Constants.App.SparkplugSrc,
        config: { source: DEVICE },
      },
    });

    const res = make_res();
    await api.delete_dataset(make_req(SRC_A), res);

    expect(res.code).toBe(200);
    expect(res.body).toBe(SRC_A);
    expect(calls.deleted).toEqual([SRC_A]);
  });

  test("refuses to delete a dataset listed by a union", async () => {
    const { api, calls } = make_api({
      [SRC_A]: {
        structure: Constants.App.SparkplugSrc,
        config: { source: DEVICE },
      },
      [UNION]: {
        structure: Constants.App.UnionComponents,
        config: [SRC_A, SRC_B],
      },
    });

    const res = make_res();
    await api.delete_dataset(make_req(SRC_A), res);

    expect(res.code).toBe(409);
    expect(res.body.error).toBe("dataset_in_use");
    expect(res.body.referrers).toEqual([
      { dataset: UNION, structure: Constants.App.UnionComponents },
    ]);
    expect(calls.deleted).toEqual([]);
    expect(calls.removed_subclasses).toEqual([]);
  });

  test("refuses to delete a dataset used as a session source", async () => {
    const { api, calls } = make_api({
      [SRC_A]: {
        structure: Constants.App.SparkplugSrc,
        config: { source: DEVICE },
      },
      [SESSION]: {
        structure: Constants.App.SessionLimits,
        config: {
          source: SRC_A,
          from: "2025-01-01T00:00:00.000Z",
          to: "2025-01-02T00:00:00.000Z",
        },
      },
    });

    const res = make_res();
    await api.delete_dataset(make_req(SRC_A), res);

    expect(res.code).toBe(409);
    expect(res.body.referrers).toEqual([
      { dataset: SESSION, structure: Constants.App.SessionLimits },
    ]);
    expect(calls.deleted).toEqual([]);
  });

  test("lists every referrer, not only the first", async () => {
    const { api } = make_api({
      [SRC_A]: {
        structure: Constants.App.SparkplugSrc,
        config: { source: DEVICE },
      },
      [UNION]: {
        structure: Constants.App.UnionComponents,
        config: [SRC_A],
      },
      [SESSION]: {
        structure: Constants.App.SessionLimits,
        config: {
          source: SRC_A,
          from: "2025-01-01T00:00:00.000Z",
          to: "2025-01-02T00:00:00.000Z",
        },
      },
    });

    const res = make_res();
    await api.delete_dataset(make_req(SRC_A), res);

    expect(res.code).toBe(409);
    expect(res.body.referrers.map(r => r.dataset).sort())
      .toEqual([SESSION, UNION].sort());
  });

  test("deletes a union once nothing points at it", async () => {
    const { api, calls } = make_api({
      [SRC_A]: {
        structure: Constants.App.SparkplugSrc,
        config: { source: DEVICE },
      },
      [UNION]: {
        structure: Constants.App.UnionComponents,
        config: [SRC_A],
      },
    });

    const res = make_res();
    await api.delete_dataset(make_req(UNION), res);

    expect(res.code).toBe(200);
    expect(calls.deleted).toEqual([UNION]);
    /* The union is the superclass of its components. */
    expect(calls.removed_subclasses).toEqual([[UNION, SRC_A]]);
  });

  test("drops the link a session owns on its source", async () => {
    const { api, calls } = make_api({
      [SRC_A]: {
        structure: Constants.App.SparkplugSrc,
        config: { source: DEVICE },
      },
      [SESSION]: {
        structure: Constants.App.SessionLimits,
        config: {
          source: SRC_A,
          from: "2025-01-01T00:00:00.000Z",
          to: "2025-01-02T00:00:00.000Z",
        },
      },
    });

    const res = make_res();
    await api.delete_dataset(make_req(SESSION), res);

    expect(res.code).toBe(200);
    expect(calls.deleted).toEqual([SESSION]);
    /* A session is a subclass of its source, so the link points the other
     * way and the old direct-subclasses sweep never saw it. */
    expect(calls.removed_subclasses).toEqual([[SRC_A, SESSION]]);
  });

  test("finds referrers whose own dataset is invalid", async () => {
    /* A dataset with two structural definitions is invalid, but it keeps
     * its config documents and can still hold a dangling reference. */
    const { api, calls } = make_api(
      {
        [SRC_A]: {
          structure: Constants.App.SparkplugSrc,
          config: { source: DEVICE },
        },
        /* DataFlow reports the union as invalid with a null config. */
        [UNION]: {
          structure: Constants.Special.InvalidDataset,
          config: null,
        },
      },
      {
        /* ConfigDB still holds the list. */
        [Constants.App.UnionComponents]: { [UNION]: [SRC_A] },
      },
    );

    const res = make_res();
    await api.delete_dataset(make_req(SRC_A), res);

    expect(res.code).toBe(409);
    expect(res.body.referrers).toEqual([
      { dataset: UNION, structure: Constants.App.UnionComponents },
    ]);
    expect(calls.deleted).toEqual([]);
  });

  test("a dataset does not count as its own referrer", async () => {
    const { api, calls } = make_api({
      [UNION]: {
        structure: Constants.App.UnionComponents,
        config: [UNION],
      },
    });

    const res = make_res();
    await api.delete_dataset(make_req(UNION), res);

    expect(res.code).toBe(200);
    expect(calls.deleted).toEqual([UNION]);
  });

  test("rejects an invalid uuid before touching ConfigDB", async () => {
    const { api, calls } = make_api({});

    await expect(api.delete_dataset(make_req("xxx"), make_res()))
      .rejects.toMatchObject({ status: 422 });

    expect(calls.deleted).toEqual([]);
  });
});
