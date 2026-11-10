/*
 * ACS Data Access Service
 * Default device datasets: one UNS device dataset for each placed device
 * Copyright 2026 University of Sheffield
 */

import pLimit from "p-limit";
import * as rx from "rxjs";
import { v5 as uuidv5 } from "uuid";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { DataAccess as Constants } from "./constants.js";
import { backoff, coalesce } from "./rx-util.js";

/* Every device with an ISA-95 placement gets one UNS device dataset,
 * its default dataset, which Data Access makes and owns. The dataset's
 * UUID is derived from the device's, so making it twice makes one
 * dataset, and a dataset can be recognised as a default without a
 * marker anyone could add or remove.
 *
 * Anyone who may build datasets from the device (UseDevice) may read
 * its default dataset and use it in unions and sessions, so people who
 * share a device share one dataset for it. The default dataset is the
 * only whole-device dataset a device needs, so nobody can make another
 * UNS device dataset, and nobody can edit, rename or delete a default
 * one: Data Access keeps it, and keeps its name the device's name. */

/* The permissions UseDevice on a device gives on its default dataset. */
export const DEVICE_PERMS = new Set([
  Constants.Perm.ReadDataset,
  Constants.Perm.IncludeInUnion,
  Constants.Perm.UseForSession,
]);

/* Not a permission anyone can be granted. The dataset lists take it in
 * place of one for "may read this dataset's structure": EditDataset on
 * the dataset, or UseDevice on the device of a default dataset. */
export const READ_STRUCTURE = "read-structure";

/* The default dataset UUID of each device asked for so far. Every list
 * and every permission check asks for the same devices again, and each
 * answer costs a SHA-1. */
const DEFAULT_UUIDS = new Map();
const DEFAULT_UUIDS_MAX = 50000;
const UUID_LENGTH = 36;

/** The UUID of a device's default dataset. */
export function default_dataset_uuid(device) {
  let dataset = DEFAULT_UUIDS.get(device);
  if (dataset === undefined) {
    dataset = uuidv5(device, Constants.Special.DefaultDatasetNamespace);
    /* A stored UNS device config can name anything as its device, of
     * any length. Only a string as long as a UUID is kept, so nothing
     * but device UUIDs can fill the Map. */
    if (typeof device != "string" || device.length != UUID_LENGTH)
      return dataset;
    DEFAULT_UUIDS.set(device, dataset);
    if (DEFAULT_UUIDS.size > DEFAULT_UUIDS_MAX) DEFAULT_UUIDS.clear();
  }
  return dataset;
}

/** The device a default dataset reads.
 *
 * @param uuid The dataset's UUID.
 * @param dataset `{ structure, config }` as the dataset map holds it.
 * @returns The device UUID, or null if this is not a default dataset.
 */
export function default_dataset_device(uuid, dataset) {
  if (dataset?.structure != Constants.App.UNSDevice) return null;
  const device = dataset.config?.source;
  if (typeof device != "string") return null;
  /* uuidv5 throws on a namespace-shaped argument that is not a UUID. */
  try {
    return default_dataset_uuid(device) == uuid ? device : null;
  }
  catch {
    return null;
  }
}

/** The devices that should have a default dataset and have none.
 *
 * @param placements Map device UUID -> ISA-95 placement config, or null.
 * @param devices A Set of the UUIDs that are devices, or null.
 * @param datasets The dataset map; anything with `has`.
 * @returns An array of `{ device, dataset }`.
 */
export function missing_defaults(placements, devices, datasets) {
  const out = [];
  /* ConfigDB gives null for an app or class it cannot read. */
  if (!placements || !devices) return out;
  for (const [device, placement] of placements) {
    if (typeof placement?.node != "string" || placement.node == "") continue;
    if (!devices.has(device)) continue;
    const dataset = default_dataset_uuid(device);
    if (!datasets.has(dataset)) out.push({ device, dataset });
  }
  return out;
}

/** The default datasets whose name is not their device's name.
 *
 * @param defaults Map dataset UUID -> device UUID.
 * @param infos The General information of every object; anything with
 * `get`. A device with no name leaves its dataset's name alone.
 * @returns An array of `{ dataset, name }`.
 */
export function stale_names(defaults, infos) {
  const out = [];
  if (!defaults || !infos) return out;
  for (const [dataset, device] of defaults) {
    const name = infos.get(device)?.name;
    if (typeof name != "string" || name == "") continue;
    if (infos.get(dataset)?.name !== name) out.push({ dataset, name });
  }
  return out;
}

export class DefaultDatasets {
  /** Construct the default dataset maker.
   * @arg opts.data The DataFlow, for the dataset map and names.
   * @arg opts.cdb A ConfigDB interface.
   * @arg opts.debug The debug logger.
   * @arg opts.enabled Whether to make datasets at all. A site with no
   * UNS bucket cannot read a UNS device dataset, so it makes none.
   * @arg opts.placements An Observable of Maps device -> placement.
   * @arg opts.devices An Observable of Sets of device UUIDs.
   * @arg opts.concurrency How many datasets to make at a time.
   * @arg opts.clock A function that gives the time in milliseconds.
   * @arg opts.retry_delay How long to wait, in milliseconds, before
   * reading the inputs again after the first error.
   */
  constructor(opts) {
    this.data = opts.data;
    this.cdb = opts.cdb;
    this.log = opts.debug.bound("defaults");
    this.enabled = opts.enabled ?? true;

    this.placements = opts.placements
      ?? this.cdb.search_app(Constants.External.ISA95Placement);
    this.devices = opts.devices
      ?? this.cdb.watch_members(UUIDs.Class.Device);

    this.debounce = opts.debounce ?? 2000;
    /* Datasets that failed are tried again this often. */
    this.retry_interval = opts.retry_interval ?? 5*60*1000;
    /* A dataset just made is not made again until the dataset map has
     * had this long to show it. */
    this.settle = opts.settle ?? 60*1000;
    this.made = new Map();

    /* An input that fails is read again after this long, and after
     * twice as long for each further error in a row, up to 64 times.
     * The wait goes back to the start when the inputs have answered
     * and stayed up for the debounce: see jobs() and renames(). The
     * retried pipelines say nothing while nothing is missing and no
     * name is stale, so the retry cannot tell that from its output. */
    this.retry_delay = opts.retry_delay ?? 5000;
    this.jobs_retry = backoff(this.retry_delay,
      e => this.log("Default device datasets failed, will retry: %s", e));
    this.names_retry = backoff(this.retry_delay,
      e => this.log("Default device dataset names failed, will retry: %s", e));

    /* How many datasets are made at a time. */
    this.concurrency = opts.concurrency ?? 4;
    this.clock = opts.clock ?? (() => Date.now());

    /* The newest inputs. A pass reads these, never an older list. */
    this.latest = null;
    this.latest_names = null;
    /* The pass that is running, if one is: a Promise that resolves
     * when it ends. */
    this.draining = null;
    this.renaming = null;
    this.stopped = false;
    /* How many times the maker has been stopped. A pass ends at the
     * next stop, whatever happens after it: run() straight after
     * stop() starts a new pass from the newest inputs, and the old
     * pass must not take up its list again beside it. */
    this.stops = 0;
  }

  /** The newest placements, devices and dataset map, and a timer so a
   * failure is retried. Each value is kept in `latest` as it arrives. */
  inputs() {
    return rx.combineLatest({
      placements: this.placements,
      devices:    this.devices,
      datasets:   this.data.datasets,
      tick:       rx.timer(0, this.retry_interval),
    }).pipe(
      rx.tap(v => this.latest = v));
  }

  /** The datasets to make, as arrays of `{ device, dataset }`. Emits
   * whenever a placement, a device or a dataset changes, and on a
   * timer so a failure is retried. The first emission covers every
   * placed device, which makes the datasets of a site that has just
   * upgraded. */
  jobs() {
    return this.inputs().pipe(
      rx.debounceTime(this.debounce),
      rx.tap(() => this.jobs_retry.reset()),
      rx.map(({ placements, devices, datasets }) =>
        missing_defaults(placements, devices, datasets)),
      rx.filter(missing => missing.length > 0));
  }

  /** The names to set, as arrays of `{ dataset, name }`. Emits
   * whenever a default dataset or a name changes. */
  renames() {
    return rx.combineLatest({
      defaults: this.data.default_devices,
      infos:    this.data.general_infos,
    }).pipe(
      rx.tap(v => this.latest_names = v),
      rx.debounceTime(this.debounce),
      rx.tap(() => this.names_retry.reset()),
      rx.map(({ defaults, infos }) => stale_names(defaults, infos)),
      rx.filter(stale => stale.length > 0));
  }

  run() {
    if (!this.enabled) {
      this.log("No UNS bucket: not making default device datasets");
      return this;
    }

    this.stopped = false;
    this.jobs_retry.reset();
    this.names_retry.reset();

    /* A list from `jobs` or `renames` only says there is work. The
     * pass reads the newest inputs, and lists that arrive while it
     * runs collapse into one further pass, so no stale list waits its
     * turn. An input error is retried: it does not stop the maker. */
    this.subscription = this.jobs().pipe(
      coalesce(() => this.drain()),
      this.jobs_retry.retry(),
    ).subscribe({
      error: e => this.log("Default device datasets stopped: %s", e),
    });
    this.subscription.add(this.renames().pipe(
      coalesce(() => this.rename_drain()),
      this.names_retry.retry(),
    ).subscribe({
      error: e => this.log("Default device dataset names stopped: %s", e),
    }));
    this.log("Making default device datasets");
    return this;
  }

  /** Stop making datasets and setting names. A dataset that is being
   * made is finished, and so is a name that is being set; nothing
   * else is started. A pass that was running does not start again
   * when run() is called: the new run makes its own. */
  stop() {
    this.stopped = true;
    this.stops++;
    this.subscription?.unsubscribe();
  }

  /** Make every dataset the newest inputs show as missing: one pass.
   *
   * At most one pass runs at a time. The guard is here, not only in
   * `coalesce`, because an input error ends the subscription while
   * its pass still runs, and the retried subscription would start a
   * second pass beside it.
   *
   * A call that waits for a running pass belongs to the subscription
   * that made it. If the maker is stopped while the call waits, the
   * call starts nothing, even when run() has been called since: the
   * new run asks for its own pass, after its own debounce.
   * @returns How many datasets the pass made. */
  async drain() {
    const stops = this.stops;
    while (this.draining) await this.draining;
    if (this.stopped || this.stops != stops || !this.latest) return 0;

    const { placements, devices, datasets } = this.latest;
    const pass = this.make_all(missing_defaults(placements, devices, datasets));
    const ended = pass.then(() => {}, () => {});
    this.draining = ended;
    ended.then(() => { if (this.draining === ended) this.draining = null; });
    return pass;
  }

  /** Set every name the newest inputs show as stale: one pass, with
   * the same guard as `drain`.
   * @returns How many names the pass set. */
  async rename_drain() {
    const stops = this.stops;
    while (this.renaming) await this.renaming;
    if (this.stopped || this.stops != stops || !this.latest_names) return 0;

    const { defaults, infos } = this.latest_names;
    const pass = this.rename_all(stale_names(defaults, infos));
    const ended = pass.then(() => {}, () => {});
    this.renaming = ended;
    ended.then(() => { if (this.renaming === ended) this.renaming = null; });
    return pass;
  }

  /** Make each missing dataset, a few at a time. Never throws: a
   * dataset that fails is logged and tried again later.
   *
   * @param missing An array of `{ device, dataset }`.
   * @param now The time to use for every dataset. Leave it out to read
   * the clock as each dataset starts and as it is finished.
   * @returns How many datasets were made. */
  async make_all(missing, now) {
    const started = this.clock();
    const stops = this.stops;
    const limit = pLimit(this.concurrency);
    let made = 0;

    await Promise.all(missing.map(({ device, dataset }) => limit(async () => {
      if (this.stopped || this.stops != stops) return;
      const t = now ?? this.clock();
      if (t - (this.made.get(dataset) ?? -Infinity) < this.settle) return;
      /* The list can be older than the dataset map by the time this
       * dataset's turn comes. */
      if (this.latest?.datasets?.has(dataset)) return;
      try {
        await this.make(device, dataset);
        /* The time it was finished, so the settle time starts when
         * the dataset map can first show it, however long the pass. */
        this.made.set(dataset, now ?? this.clock());
        made++;
      }
      catch (e) {
        this.log("Can't make the default dataset of %s: %s", device, e);
      }
    })));

    if (made)
      this.log("Made %d default device dataset(s) in %d ms",
        made, this.clock() - started);
    return made;
  }

  /** Set each stale name. Never throws. Each write keeps the other
   * fields of the dataset's General information. A stop ends the pass:
   * the name that is being set is finished, and no ConfigDB call is
   * made for the rest of the list. */
  async rename_all(stale) {
    const stops = this.stops;
    let renamed = 0;
    for (const { dataset, name } of stale) {
      if (this.stopped || this.stops != stops) break;
      try {
        const info = await this.cdb.get_config(UUIDs.App.Info, dataset) ?? {};
        if (info.name === name) continue;
        await this.cdb.put_config(UUIDs.App.Info, dataset, { ...info, name });
        this.log("Named default dataset %s %s", dataset, name);
        renamed++;
      }
      catch (e) {
        this.log("Can't name the default dataset %s: %s", dataset, e);
      }
    }
    return renamed;
  }

  /** Make a device's default dataset now if it has none. For a caller
   * that is about to point someone at it. Never throws.
   * @returns The dataset's UUID. */
  async ensure(device) {
    const dataset = default_dataset_uuid(device);
    if (!this.enabled) return dataset;
    try {
      if (!await this.cdb.get_config(Constants.App.UNSDevice, dataset))
        await this.make(device, dataset);
    }
    catch (e) {
      this.log("Can't make the default dataset of %s: %s", device, e);
    }
    return dataset;
  }

  /* Every write here can be repeated, so a dataset left half made by
   * a failure is completed by the next attempt. Data Access owns the
   * object. */
  async make(device, dataset) {
    const { cdb } = this;

    await cdb.create_object(Constants.Class.Dataset, dataset, false);
    await cdb.put_config(Constants.App.UNSDevice, dataset, { source: device });

    /* Name it after the device. `renames` keeps it that way. */
    const name = (await cdb.get_config(UUIDs.App.Info, device))?.name;
    if (typeof name == "string" && name != "") {
      const info = await cdb.get_config(UUIDs.App.Info, dataset) ?? {};
      if (info.name !== name)
        await cdb.put_config(UUIDs.App.Info, dataset, { ...info, name });
    }

    this.log("Made default dataset %s for device %s", dataset, device);
  }
}
