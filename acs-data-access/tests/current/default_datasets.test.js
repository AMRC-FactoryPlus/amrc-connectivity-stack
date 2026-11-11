/*
 * ACS Data Access Service
 * Unit tests for default device datasets: which datasets are made, and
 * what UseDevice on a device allows on the device's default dataset.
 *
 * These run against fakes, so they need no cluster.
 */

import { Map as IMap } from "immutable";
import * as rx from "rxjs";
import { describe, expect, test } from "vitest";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { APIv1 } from "../../lib/api-v1.js";
import { DataAccess as Constants } from "../../lib/constants.js";
import { DataFlow } from "../../lib/dataflow.js";
import {
  DEVICE_PERMS, DefaultDatasets, READ_STRUCTURE,
  default_dataset_device, default_dataset_uuid, missing_defaults, stale_names,
} from "../../lib/default-datasets.js";

const { Perm, App } = Constants;

const DEV_A = "aaaaaaaa-0000-4000-8000-000000000001";
const DEV_B = "aaaaaaaa-0000-4000-8000-000000000002";
const NOT_DEVICE = "aaaaaaaa-0000-4000-8000-000000000003";
const OWN = "bbbbbbbb-0000-4000-8000-000000000001";
const NODE = "cccccccc-0000-4000-8000-000000000001";
const USER = "user@EXAMPLE.ORG";
const ROOT = "root@EXAMPLE.ORG";

const DEF_A = default_dataset_uuid(DEV_A);
const DEF_B = default_dataset_uuid(DEV_B);

const uns = device => ({ structure: App.UNSDevice, config: { source: device } });
const debug = { bound: () => () => {} };

describe("default dataset UUIDs", () => {
  test("a device always gets the same UUID, and devices get different ones", () => {
    expect(default_dataset_uuid(DEV_A)).toBe(DEF_A);
    expect(DEF_A).not.toBe(DEF_B);
    expect(DEF_A).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("recognises a default dataset by its UUID and source", () => {
    expect(default_dataset_device(DEF_A, uns(DEV_A))).toBe(DEV_A);
  });

  test("a UNS device dataset someone made is not a default", () => {
    expect(default_dataset_device(OWN, uns(DEV_A))).toBe(null);
  });

  test("a default UUID pointed at another device is not a default", () => {
    expect(default_dataset_device(DEF_A, uns(DEV_B))).toBe(null);
  });

  test("other structures and broken configs are not defaults", () => {
    expect(default_dataset_device(DEF_A,
      { structure: App.SparkplugSrc, config: { source: DEV_A } })).toBe(null);
    expect(default_dataset_device(DEF_A,
      { structure: Constants.Special.InvalidDataset, config: null })).toBe(null);
    expect(default_dataset_device(DEF_A,
      { structure: App.UNSDevice, config: { source: "not a uuid" } })).toBe(null);
    expect(default_dataset_device(DEF_A, undefined)).toBe(null);
  });
});

describe("missing_defaults", () => {
  const placements = new Map([
    [DEV_A, { node: NODE }],
    [DEV_B, { node: NODE }],
    [NOT_DEVICE, { node: NODE }],
  ]);
  const devices = new Set([DEV_A, DEV_B]);

  test("lists placed devices with no default dataset", () => {
    expect(missing_defaults(placements, devices, IMap({ [DEF_A]: uns(DEV_A) })))
      .toEqual([{ device: DEV_B, dataset: DEF_B }]);
  });

  test("a dataset someone made for the device does not count", () => {
    expect(missing_defaults(placements, devices, IMap({ [OWN]: uns(DEV_A), [DEF_B]: uns(DEV_B) })))
      .toEqual([{ device: DEV_A, dataset: DEF_A }]);
  });

  test("skips a device with no placement node, and a placed object that is not a device", () => {
    const some = new Map([[DEV_A, {}], [DEV_B, { node: "" }], [NOT_DEVICE, { node: NODE }]]);
    expect(missing_defaults(some, devices, IMap())).toEqual([]);
  });

  test("lists nothing when ConfigDB cannot read the placements or the devices", () => {
    expect(missing_defaults(null, devices, IMap())).toEqual([]);
    expect(missing_defaults(placements, null, IMap())).toEqual([]);
  });
});

/* A fake ConfigDB that records its writes. `configs` maps
 * `${app}/${object}` to a config. */
function fake_cdb(configs = {}, { fail_on } = {}) {
  const calls = { create: [], put: [] };
  const cdb = {
    async create_object(klass, obj, excl, owner) {
      if (fail_on == obj) throw new Error("ConfigDB is down");
      calls.create.push({ klass, obj, excl, owner });
      return obj;
    },
    async put_config(app, obj, config) {
      calls.put.push({ app, obj, config });
      configs[`${app}/${obj}`] = config;
    },
    async get_config(app, obj) { return configs[`${app}/${obj}`]; },
  };
  return { cdb, calls, configs };
}

function maker(opts = {}) {
  return new DefaultDatasets({
    debug,
    placements: opts.placements ?? rx.of(new Map()),
    devices: opts.devices ?? rx.of(new Set()),
    debounce: 0,
    ...opts,
    data: opts.data ?? { datasets: opts.datasets ?? rx.of(IMap()) },
  });
}

describe("DefaultDatasets", () => {
  test("makes the dataset with the device's UUID, owned by Data Access, named after the device", async () => {
    const { cdb, calls } = fake_cdb({ [`${UUIDs.App.Info}/${DEV_A}`]: { name: "Lathe" } });
    await maker({ cdb }).make(DEV_A, DEF_A);

    expect(calls.create).toEqual([
      { klass: Constants.Class.Dataset, obj: DEF_A, excl: false, owner: undefined }]);
    expect(calls.put).toEqual([
      { app: App.UNSDevice, obj: DEF_A, config: { source: DEV_A } },
      { app: UUIDs.App.Info, obj: DEF_A, config: { name: "Lathe" } },
    ]);
  });

  test("does not write a name the dataset already has", async () => {
    const { cdb, calls } = fake_cdb({
      [`${UUIDs.App.Info}/${DEV_A}`]: { name: "Lathe" },
      [`${UUIDs.App.Info}/${DEF_A}`]: { name: "Lathe" },
    });
    await maker({ cdb }).make(DEV_A, DEF_A);
    expect(calls.put.map(p => p.app)).toEqual([App.UNSDevice]);
  });

  test("ensure makes a missing dataset and leaves an existing one", async () => {
    const { cdb, calls } = fake_cdb();
    const m = maker({ cdb });
    expect(await m.ensure(DEV_A)).toBe(DEF_A);
    expect(await m.ensure(DEV_A)).toBe(DEF_A);
    expect(calls.create.map(c => c.obj)).toEqual([DEF_A]);
  });

  test("ensure still names the dataset when ConfigDB fails", async () => {
    const { cdb } = fake_cdb({}, { fail_on: DEF_A });
    expect(await maker({ cdb }).ensure(DEV_A)).toBe(DEF_A);
  });

  test("leaves the dataset unnamed when the device has no name", async () => {
    const { cdb, calls } = fake_cdb();
    await maker({ cdb }).make(DEV_A, DEF_A);
    expect(calls.put.map(p => p.app)).toEqual([App.UNSDevice]);
  });

  test("one failure does not stop the others, and is tried again", async () => {
    const { cdb, calls } = fake_cdb({}, { fail_on: DEF_A });
    const m = maker({ cdb });
    const missing = [{ device: DEV_A, dataset: DEF_A }, { device: DEV_B, dataset: DEF_B }];

    expect(await m.make_all(missing, 1000)).toBe(1);
    expect(calls.create.map(c => c.obj)).toEqual([DEF_B]);

    /* Straight away, the one that failed is tried again; the one just
     * made is left until the dataset map has had time to show it. */
    expect(await m.make_all(missing, 2000)).toBe(0);
    expect(calls.create.map(c => c.obj)).toEqual([DEF_B]);
  });

  test("makes a dataset again once the settle time has passed", async () => {
    const { cdb, calls } = fake_cdb();
    const m = maker({ cdb, settle: 100 });
    const missing = [{ device: DEV_A, dataset: DEF_A }];
    await m.make_all(missing, 1000);
    await m.make_all(missing, 1050);
    await m.make_all(missing, 1200);
    expect(calls.create.length).toBe(2);
  });

  test("jobs lists what is missing, and is quiet when nothing is", async () => {
    const m = maker({
      cdb: fake_cdb().cdb,
      placements: rx.of(new Map([[DEV_A, { node: NODE }], [DEV_B, { node: NODE }]])),
      devices: rx.of(new Set([DEV_A, DEV_B])),
      datasets: rx.of(IMap({ [DEF_A]: uns(DEV_A) })),
    });
    expect(await rx.firstValueFrom(m.jobs()))
      .toEqual([{ device: DEV_B, dataset: DEF_B }]);

    const none = maker({
      cdb: fake_cdb().cdb,
      placements: rx.of(new Map([[DEV_A, { node: NODE }]])),
      devices: rx.of(new Set([DEV_A])),
      datasets: rx.of(IMap({ [DEF_A]: uns(DEV_A) })),
      retry_interval: 5,
    });
    const seen = await rx.firstValueFrom(
      none.jobs().pipe(rx.takeUntil(rx.timer(40)), rx.toArray()));
    expect(seen).toEqual([]);
  });

  test("a site with no UNS bucket makes nothing", () => {
    const m = maker({ cdb: fake_cdb().cdb, enabled: false });
    m.run();
    expect(m.subscription).toBeUndefined();
  });
});

describe("default dataset names", () => {
  const defaults = new Map([[DEF_A, DEV_A], [DEF_B, DEV_B]]);

  test("lists a dataset whose name is not its device's", () => {
    const infos = IMap({
      [DEV_A]: { name: "Lathe 2" }, [DEF_A]: { name: "Lathe" },
      [DEV_B]: { name: "Mill" }, [DEF_B]: { name: "Mill" },
    });
    expect(stale_names(defaults, infos)).toEqual([{ dataset: DEF_A, name: "Lathe 2" }]);
  });

  test("lists a dataset with no name, and skips a device with none", () => {
    const infos = IMap({ [DEV_A]: { name: "Lathe" }, [DEF_B]: { name: "Old" } });
    expect(stale_names(defaults, infos)).toEqual([{ dataset: DEF_A, name: "Lathe" }]);
  });

  test("a device rename renames its default dataset, keeping other fields", async () => {
    const { cdb, calls } = fake_cdb({
      [`${UUIDs.App.Info}/${DEF_A}`]: { name: "Lathe", deleted: false },
    });
    const m = maker({ cdb });
    expect(await m.rename_all([{ dataset: DEF_A, name: "Lathe 2" }])).toBe(1);
    expect(calls.put).toEqual([
      { app: UUIDs.App.Info, obj: DEF_A, config: { name: "Lathe 2", deleted: false } }]);
    /* The map may lag the write: a second pass writes nothing. */
    expect(await m.rename_all([{ dataset: DEF_A, name: "Lathe 2" }])).toBe(0);
  });

  test("renames follows the dataset map and the names", async () => {
    const m = maker({
      cdb: fake_cdb().cdb,
      data: {
        /* No index to wait for. */
        caught_up: async () => true,
        default_devices: rx.of(defaults),
        general_infos: rx.of(IMap({ [DEV_A]: { name: "Lathe" } })),
      },
    });
    expect(await rx.firstValueFrom(m.renames()))
      .toEqual([{ dataset: DEF_A, name: "Lathe" }]);
  });
});

/* A fake Auth: `grants` maps a permission to the targets USER holds it
 * on. */
function fake_auth(grants) {
  const has = (perm, target) =>
    (grants[perm] ?? []).some(t => t == target || t == UUIDs.Special.Null);
  return {
    root_principal: ROOT,
    async check_acl(principal, perm, target) {
      return principal == ROOT || (principal == USER && has(perm, target));
    },
    watch_acl_with_perm(principal, perm) {
      return rx.of(new Set(principal == USER ? grants[perm] ?? [] : []));
    },
  };
}

const DATASETS = IMap({
  [DEF_A]: uns(DEV_A),
  [DEF_B]: uns(DEV_B),
  [OWN]: uns(DEV_A),
});

function make_api(grants) {
  const configs = {};
  for (const [uuid, d] of DATASETS) configs[`${d.structure}/${uuid}`] = d.config;
  for (const device of [DEV_A, DEV_B])
    configs[`${Constants.External.ISA95Placement}/${device}`] = { node: NODE };
  const { cdb, calls } = fake_cdb(configs);
  Object.assign(cdb, {
    async class_has_member() { return true; },
    async class_direct_subclasses() { return []; },
    async delete_object(uuid) { calls.deleted = uuid; },
    search_app: () => rx.of(IMap()),
  });
  const api = new APIv1({
    data: {
      /* No index to wait for. */
      caught_up: async () => true,
      datasets: rx.of(DATASETS),
      allowed_all_datasets: () => rx.of(DATASETS),
    },
    auth: fake_auth(grants),
    cdb,
    debug,
    influxReader: {},
    buckets: { uns: "uns" },
  });
  api.calls = calls;
  return api;
}

function make_res() {
  return {
    code: null,
    body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

/* Root holds every permission, so these show the refusal does not
 * depend on what the caller was granted. */
describe("a default dataset is kept by Data Access", () => {
  test("nobody can delete it", async () => {
    const api = make_api({});
    const res = make_res();
    await api.delete_dataset({ auth: ROOT, params: { uuid: DEF_A } }, res);
    expect(res.code).toBe(409);
    expect(res.body).toMatchObject({ error: "default_dataset", device: DEV_A, dataset: DEF_A });
    expect(api.calls.deleted).toBeUndefined();
  });

  test("a dataset someone made for the device can still be deleted", async () => {
    const api = make_api({});
    const res = make_res();
    await api.delete_dataset({ auth: ROOT, params: { uuid: OWN } }, res);
    expect(res.code).toBe(200);
    expect(api.calls.deleted).toBe(OWN);
  });

  test.each([
    ["name", "metadata_put_name", { name: "Mine" }],
    ["tags", "metadata_put_tags", { tags: ["a"] }],
    ["labels", "metadata_put_labels", { labels: {} }],
    ["kind", "metadata_put_kind", { kind: null }],
    ["run details", "metadata_put_run", { reference: "x" }],
    ["run details, in part", "metadata_patch_run", { reference: "x" }],
  ])("nobody can change its %s", async (_, route, body) => {
    const api = make_api({});
    const res = make_res();
    await api.refusable(api[route])(
      { auth: ROOT, params: { uuid: DEF_A }, body }, res);
    expect(res.code).toBe(409);
    expect(res.body).toMatchObject({ error: "default_dataset", dataset: DEF_A });
    expect(api.calls.put).toEqual([]);
  });

  test("the name of a dataset someone made can still be changed", async () => {
    const api = make_api({});
    const res = make_res();
    await api.refusable(api.metadata_put_name)(
      { auth: ROOT, params: { uuid: OWN }, body: { name: "Mine" } }, res);
    expect(res.code).toBe(204);
    expect(api.calls.put).toEqual([
      { app: UUIDs.App.Info, obj: OWN, config: { name: "Mine" } }]);
  });

  test("nobody can point it at another device", async () => {
    const api = make_api({});
    const res = make_res();
    await api.structure_update({ auth: ROOT, params: { uuid: DEF_A },
      body: { structure: App.UNSDevice, config: { source: DEV_B } } }, res);
    expect(res.code).toBe(409);
    expect(res.body.error).toBe("default_dataset");
    expect(api.calls.put).toEqual([]);
  });

  test("a caller without Delete learns nothing about it", async () => {
    const api = make_api({ [Perm.UseDevice]: [DEV_A] });
    await expect(api.delete_dataset({ auth: USER, params: { uuid: DEF_A } }, make_res()))
      .rejects.toMatchObject({ status: 403 });
  });
});

describe("new UNS device datasets", () => {
  test("are refused for everyone, and the refusal makes sure the default exists", async () => {
    const api = make_api({});
    const ensured = [];
    api.defaults = { ensure: async d => { ensured.push(d); return default_dataset_uuid(d); } };
    const res = make_res();
    await api.structure_create({ auth: ROOT,
      body: { structure: App.UNSDevice, config: { source: DEV_B } } }, res);
    expect(res.code).toBe(409);
    expect(res.body).toMatchObject({ error: "use_default_dataset", device: DEV_B, dataset: DEF_B });
    expect(ensured).toEqual([DEV_B]);
    expect(api.calls.create).toEqual([]);
  });

  test("an older device dataset cannot be pointed at another device", async () => {
    const api = make_api({});
    const res = make_res();
    await api.structure_update({ auth: ROOT, params: { uuid: OWN },
      body: { structure: App.UNSDevice, config: { source: DEV_B } } }, res);
    expect(res.code).toBe(409);
    expect(res.body).toMatchObject({ error: "use_default_dataset", device: DEV_B, dataset: DEF_B });
    expect(api.calls.put).toEqual([]);
  });

  test("an older device dataset can be saved again with the device it has", async () => {
    const api = make_api({});
    const res = make_res();
    await api.structure_update({ auth: ROOT, params: { uuid: OWN },
      body: { structure: App.UNSDevice, config: { source: DEV_A } } }, res);
    expect(res.code).toBe(200);
  });

  test("a caller who may not use the device gets 403, not the dataset's UUID", async () => {
    const api = make_api({ [Perm.CreateDataset]: [App.UNSDevice] });
    await expect(api.structure_create({ auth: USER,
      body: { structure: App.UNSDevice, config: { source: DEV_B } } }, make_res()))
      .rejects.toMatchObject({ status: 403 });
  });
});

describe("check_dataset_acl", () => {
  test.each([...DEVICE_PERMS])("UseDevice on a device allows %s on its default dataset", async perm => {
    const api = make_api({ [Perm.UseDevice]: [DEV_A] });
    expect(await api.check_dataset_acl(USER, perm, DEF_A)).toBe(true);
  });

  test("it does not allow Edit or Delete", async () => {
    const api = make_api({ [Perm.UseDevice]: [DEV_A] });
    expect(await api.check_dataset_acl(USER, Perm.EditDataset, DEF_A)).toBe(false);
    expect(await api.check_dataset_acl(USER, Perm.DeleteDataset, DEF_A)).toBe(false);
  });

  test("it allows nothing on another device's default dataset", async () => {
    const api = make_api({ [Perm.UseDevice]: [DEV_A] });
    expect(await api.check_dataset_acl(USER, Perm.ReadDataset, DEF_B)).toBe(false);
  });

  test("it allows nothing on a dataset someone made for the device", async () => {
    const api = make_api({ [Perm.UseDevice]: [DEV_A] });
    expect(await api.check_dataset_acl(USER, Perm.ReadDataset, OWN)).toBe(false);
  });

  test("a grant on the dataset still works without UseDevice", async () => {
    const api = make_api({ [Perm.ReadDataset]: [OWN, DEF_B] });
    expect(await api.check_dataset_acl(USER, Perm.ReadDataset, OWN)).toBe(true);
    expect(await api.check_dataset_acl(USER, Perm.ReadDataset, DEF_B)).toBe(true);
  });

  test("a union may include the default dataset of a device the caller may use", async () => {
    const api = make_api({ [Perm.UseDevice]: [DEV_A] });
    const union = api.handlers[App.UnionComponents];
    expect(await union.check_sources_permissions(USER, [DEF_A])).toBe(true);
    expect(await union.check_sources_permissions(USER, [DEF_A, DEF_B])).toBe(false);
  });

  test("a session may use the default dataset of a device the caller may use", async () => {
    const api = make_api({ [Perm.UseDevice]: [DEV_A] });
    const session = api.handlers[App.SessionLimits];
    expect(await session.check_sources_permissions(USER, { source: DEF_A })).toBe(true);
    expect(await session.check_sources_permissions(USER, { source: DEF_B })).toBe(false);
  });
});

describe("dataset lists", () => {
  async function listed(grants, perm, principal = USER) {
    const flow = Object.create(DataFlow.prototype);
    flow.auth = fake_auth(grants);
    flow.datasets = rx.of(DATASETS);
    flow.default_devices = flow._build_default_devices();
    const out = await rx.firstValueFrom(
      rx.of(DATASETS).pipe(flow.filter_allowed_datasets(principal, perm)));
    return [...out.keys()].sort();
  }

  test.each([...DEVICE_PERMS])("UseDevice on a device lists its default dataset for %s", async perm => {
    expect(await listed({ [Perm.UseDevice]: [DEV_A] }, perm)).toEqual([DEF_A]);
  });

  test("UseDevice on every device lists every default dataset, and no other", async () => {
    expect(await listed({ [Perm.UseDevice]: [UUIDs.Special.Null] }, Perm.ReadDataset))
      .toEqual([DEF_A, DEF_B].sort());
  });

  test("the structure list gains default datasets, beside the ones the caller may edit", async () => {
    expect(await listed({ [Perm.UseDevice]: [DEV_A], [Perm.EditDataset]: [OWN] }, READ_STRUCTURE))
      .toEqual([DEF_A, OWN].sort());
    const api = make_api({ [Perm.UseDevice]: [DEV_A], [Perm.EditDataset]: [OWN] });
    expect(await api.check_dataset_acl(USER, READ_STRUCTURE, DEF_A)).toBe(true);
    expect(await api.check_dataset_acl(USER, READ_STRUCTURE, OWN)).toBe(true);
    expect(await api.check_dataset_acl(USER, READ_STRUCTURE, DEF_B)).toBe(false);
  });

  test("the Edit list does not gain default datasets", async () => {
    expect(await listed({ [Perm.UseDevice]: [DEV_A] }, Perm.EditDataset)).toEqual([]);
  });

  test("grants on datasets and on devices add up", async () => {
    expect(await listed({ [Perm.UseDevice]: [DEV_B], [Perm.ReadDataset]: [OWN] }, Perm.ReadDataset))
      .toEqual([DEF_B, OWN].sort());
  });

  test("the lists and the single check agree", async () => {
    const grants = { [Perm.UseDevice]: [DEV_A], [Perm.ReadDataset]: [OWN] };
    const api = make_api(grants);
    const list = await listed(grants, Perm.ReadDataset);
    for (const uuid of DATASETS.keys())
      expect(await api.check_dataset_acl(USER, Perm.ReadDataset, uuid))
        .toBe(list.includes(uuid));
  });
});
