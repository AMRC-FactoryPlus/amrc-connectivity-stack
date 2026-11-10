/*
 * ACS Data Access Service
 * Default device datasets: one UNS device dataset for each placed device
 * Copyright 2026 University of Sheffield
 */

import * as rx from "rxjs";
import { v5 as uuidv5 } from "uuid";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { DataAccess as Constants } from "./constants.js";

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

/** The UUID of a device's default dataset. */
export function default_dataset_uuid(device) {
  return uuidv5(device, Constants.Special.DefaultDatasetNamespace);
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
  }

  /** The datasets to make, as arrays of `{ device, dataset }`. Emits
   * whenever a placement, a device or a dataset changes, and on a
   * timer so a failure is retried. The first emission covers every
   * placed device, which makes the datasets of a site that has just
   * upgraded. */
  jobs() {
    return rx.combineLatest({
      placements: this.placements,
      devices:    this.devices,
      datasets:   this.data.datasets,
      tick:       rx.timer(0, this.retry_interval),
    }).pipe(
      rx.debounceTime(this.debounce),
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
      rx.debounceTime(this.debounce),
      rx.map(({ defaults, infos }) => stale_names(defaults, infos)),
      rx.filter(stale => stale.length > 0));
  }

  run() {
    if (!this.enabled) {
      this.log("No UNS bucket: not making default device datasets");
      return this;
    }

    this.subscription = this.jobs().pipe(
      rx.concatMap(missing => this.make_all(missing)),
    ).subscribe({
      error: e => this.log("Default device datasets stopped: %s", e),
    });
    this.subscription.add(this.renames().pipe(
      rx.concatMap(stale => this.rename_all(stale)),
    ).subscribe({
      error: e => this.log("Default device dataset names stopped: %s", e),
    }));
    this.log("Making default device datasets");
    return this;
  }

  stop() {
    this.subscription?.unsubscribe();
  }

  /** Make each missing dataset, one at a time. Never throws: a
   * dataset that fails is logged and tried again later. */
  async make_all(missing, now = Date.now()) {
    let made = 0;
    for (const { device, dataset } of missing) {
      if (now - (this.made.get(dataset) ?? -Infinity) < this.settle) continue;
      try {
        await this.make(device, dataset);
        this.made.set(dataset, now);
        made++;
      }
      catch (e) {
        this.log("Can't make the default dataset of %s: %s", device, e);
      }
    }
    if (made) this.log("Made %d default device dataset(s)", made);
    return made;
  }

  /** Set each stale name. Never throws. Each write keeps the other
   * fields of the dataset's General information. */
  async rename_all(stale) {
    let renamed = 0;
    for (const { dataset, name } of stale) {
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
