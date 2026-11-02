/*
 * ACS Data Access Service
 * Unit tests for the owner of datasets created by structure_create.
 *
 * These run against fakes, so they need no cluster.
 */

import { Map as IMap } from "immutable";
import * as rx from "rxjs";
import { describe, expect, test } from "vitest";

import { ServiceError } from "@amrc-factoryplus/service-client";

import { APIv1 } from "../../lib/api-v1.js";
import { DataAccess as Constants } from "../../lib/constants.js";

const SOURCE = "11111111-1111-1111-1111-111111111111";
const CREATED = "44444444-4444-4444-4444-444444444444";
const OWNER = "88888888-8888-4888-8888-888888888888";
const OTHER = "99999999-9999-4999-8999-999999999999";
const ROOT = "root@TEST.REALM";
const UPN = "tester@TEST.REALM";

const SESSION_APP = Constants.App.SessionLimits;
const SESSION_CONFIG = {
  source: SOURCE,
  from: "2025-01-01T00:00:00.000Z",
  to: "2025-01-02T00:00:00.000Z",
};

/* Builds an APIv1 wired to fakes. `resolve` stands in for
 * Auth.resolve_principal; `create_error` makes create_object throw. */
function make_api({ resolve = async () => OWNER, create_error, denied = [] } = {}) {
  const calls = { resolve: [], create: [], put: [] };

  const auth = {
    root_principal: ROOT,
    async check_acl(principal, perm, target) {
      return !denied.some(([p, t]) => p === perm && t === target);
    },
    async resolve_principal(principal) {
      calls.resolve.push(principal);
      return resolve(principal);
    },
  };

  const cdb = {
    async create_object(klass, obj, excl, owner) {
      calls.create.push({ klass, obj, excl, owner });
      if (create_error) throw create_error;
      return CREATED;
    },
    async put_config(app, uuid, config) { calls.put.push({ app, uuid, config }); },
    async class_add_subclass() {},
    async get_config() { return undefined; },
  };

  const datasets = { [SOURCE]: { structure: Constants.App.SparkplugSrc, config: {} } };
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
    body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function create(api, auth, body = { structure: SESSION_APP, config: SESSION_CONFIG }) {
  const res = make_res();
  await api.structure_create({ body, auth }, res);
  return res;
}

describe("structure_create owner", () => {
  test("a Kerberos caller's resolved UUID becomes the owner", async () => {
    const { api, calls } = make_api();
    const res = await create(api, UPN);

    expect(res.code).toBe(200);
    expect(calls.resolve).toEqual([UPN]);
    expect(calls.create).toEqual([
      { klass: Constants.Class.Dataset, obj: undefined, excl: false, owner: OWNER }]);
  });

  test("a UUID caller is passed to resolve_principal unchanged", async () => {
    const { api, calls } = make_api({ resolve: async p => p });
    await create(api, OTHER);

    expect(calls.create[0].owner).toBe(OTHER);
  });

  test("root sends no owner and skips the lookup", async () => {
    const { api, calls } = make_api();
    const res = await create(api, ROOT);

    expect(res.code).toBe(200);
    expect(calls.resolve).toEqual([]);
    expect(calls.create[0].owner).toBeUndefined();
  });

  test("a lookup that returns nothing gives 503 and creates nothing", async () => {
    const { api, calls } = make_api({ resolve: async () => null });

    await expect(create(api, UPN)).rejects.toMatchObject({ status: 503 });
    expect(calls.create).toEqual([]);
    expect(calls.put).toEqual([]);
  });

  test("a lookup that throws gives 503 and creates nothing", async () => {
    const { api, calls } = make_api({
      resolve: async () => { throw new Error("auth down"); },
    });

    await expect(create(api, UPN)).rejects.toMatchObject({ status: 503 });
    expect(calls.create).toEqual([]);
  });

  test("an owner in the request body is ignored", async () => {
    const { api, calls } = make_api();
    await create(api, UPN,
      { structure: SESSION_APP, config: SESSION_CONFIG, owner: OTHER });

    expect(calls.create[0].owner).toBe(OWNER);
  });

  test("a 403 from CreateDataset never looks up the owner", async () => {
    const { api, calls } = make_api({
      denied: [[Constants.Perm.CreateDataset, SESSION_APP]],
    });

    await expect(create(api, UPN)).rejects.toMatchObject({ status: 403 });
    expect(calls.resolve).toEqual([]);
  });

  test("an invalid config never looks up the owner", async () => {
    const { api, calls } = make_api();

    await expect(create(api, UPN, { structure: SESSION_APP, config: { source: SOURCE } }))
      .rejects.toBeTruthy();
    expect(calls.resolve).toEqual([]);
  });

  test.each([403, 409])("ConfigDB %i on create is passed through", async status => {
    const { api, calls } = make_api({
      create_error: new ServiceError(null, "refused", status),
    });

    await expect(create(api, UPN)).rejects.toMatchObject({ status });
    expect(calls.put).toEqual([]);
  });

  test("other ConfigDB errors are rethrown unchanged", async () => {
    const err = new ServiceError(null, "down", 500);
    const { api } = make_api({ create_error: err });

    await expect(create(api, UPN)).rejects.toBe(err);
  });
});
