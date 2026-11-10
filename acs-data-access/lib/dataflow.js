/*
* ACS Data Access Service
* Data-Flow / sequence management
*/

import { List as IList, Map as IMap, is as imm_is } from "immutable";
import rx from "rxjs";

import * as rxu from "@amrc-factoryplus/rx-util";

import { DataAccess as Constants } from './constants.js';
import { UUIDs } from '@amrc-factoryplus/rx-client';
import { AppConfigs, AppMap } from './app-configs.js';
import { DatasetIndex } from './dataset-index.js';
import {
  default_dataset_device, default_dataset_uuid, DEVICE_PERMS, READ_STRUCTURE,
} from './default-datasets.js';
import { same_set, set_changes, watch_each } from './rx-util.js';

/* One field of each value of a change sequence, sent on only when the
 * field is a new object. The reducers replace a map only when an entry
 * of it differs, so this is "only when it changed". */
const field = name => rx.pipe(
  rx.map(change => change[name]),
  rx.distinctUntilChanged(),
);

/* Two grant states are the same when both allow every target, or when
 * they name the same targets. */
const same_grants = (a, b) =>
  a.all && b.all
    ? true
    : a.all == b.all && same_set(a.targets, b.targets);

/* A grant state as a predicate over targets. */
const granted_by = state =>
  state.all
    ? () => true
    : id => state.targets.has(id);

/* The datasets whose answer can differ between two values of the grant
 * states behind a permission check, as a native Set. Null means any
 * dataset can differ: a grant on every target came or went.
 *
 * `direct` is the grant state of the permission on the dataset itself.
 * `device` is the UseDevice grant state, or null where UseDevice does
 * not count. A device that gains or loses UseDevice changes the answer
 * for its default dataset and for no other. */
function grant_changes (before, now) {
  if (before.direct.all != now.direct.all) return null;
  if (before.device?.all != now.device?.all) return null;
  /* Every dataset was allowed and still is. */
  if (now.direct.all) return new Set();

  const changed = set_changes(before.direct.targets, now.direct.targets);
  if (now.device && !now.device.all) {
    const devices = set_changes(before.device.targets, now.device.targets);
    for (const device of devices)
      changed.add(default_dataset_uuid(device));
  }
  return changed;
}

export class DataFlow {
  constructor(opts) {
    this.log = opts.debug.bound("data");
    this.cdb = opts.cdb;
    this.auth = opts.auth;

    /* The DatasetIndex the dataset map comes from, once something has
     * subscribed. Its `stats` count the datasets worked out. */
    this.index = null;

    /* Each `*_changes` sequence carries `{ map, changed }`, or for
     * `changes` the four dataset maps and `changed`: what the maps
     * hold now, and the keys the last change touched. A subscriber
     * that joins late gets the latest value again, so the first value
     * it reads says nothing about which keys changed: it must count
     * every key as changed.
     *
     * The plain sequences below them are those maps alone. Each emits
     * only when its own map changes. */
    this.changes = this._build_changes();
    this.datasets = this.changes.pipe(field("datasets"));
    this.valid_datasets = this.changes.pipe(field("valid"));
    this.invalid_datasets = this.changes.pipe(field("invalid"));
    /* Default dataset UUID -> the device it reads, as an Immutable
     * Map. */
    this.default_devices = this.changes.pipe(field("defaults"));

    this.info_changes = this._build_info_changes();
    this.general_infos = this.info_changes.pipe(field("map"));

    this.metadata_changes = this._build_app_changes(
      Constants.App.DatasetMetadata
    );
    this.metadata = this.metadata_changes.pipe(field("map"));

    this.functional_changes = this._build_functional_changes();
    this.functional_types = this.functional_changes.pipe(field("map"));

    this.parts = this._build_parts();
  }

  /* Hold the dataset map, the names, the metadata and the functional
   * types for the life of the process, so no request and no notify
   * subscription has to wait for ConfigDB to answer again. A source
   * that fails still fails its current subscribers, as it always has;
   * this then connects again without waiting for a client to ask. */
  run() {
    if (this.running) return;

    const hold = (name, seq) => seq.pipe(
      rxu.retryBackoff(5000,
        e => this.log("%s failed, will retry: %s", name, e)),
    ).subscribe();

    this.running = [
      hold("Dataset map", this.changes),
      hold("General information", this.info_changes),
      hold("Dataset metadata", this.metadata_changes),
      hold("Functional types", this.functional_changes),
    ];
  }

  stop() {
    for (const sub of this.running ?? []) sub.unsubscribe();
    this.running = null;
  }

  /*
   * ---------------------------------------------------
   * Rx Operators
   * ---------------------------------------------------
   */

  /* Which targets a principal holds a permission on, as
   * `{ all, targets }`. `all` is true when every target is allowed;
   * otherwise `targets` is the Set of the targets that are.
   *
   * Auth passes the root principal and wildcard grants on every single
   * check, so the lists must agree: root, or a grant on the wildcard
   * target, allows every target. Otherwise only the grant targets do.
   *
   * Auth sends a principal's whole ACL whenever any of it changes.
   * This emits only when the grants of this one permission differ. */
  watch_grant_state(principal, permission) {
    if (this.auth.root_principal && principal == this.auth.root_principal)
      return rx.of({ all: true });

    return this.auth.watch_acl_with_perm(principal, permission).pipe(
      rx.map(targets => ({
        all: targets.has(UUIDs.Special.Null),
        targets,
      })),
      rx.distinctUntilChanged(same_grants)
    );
  }

  /* Which targets a principal holds a permission on, as a predicate. */
  watch_granted(principal, permission) {
    return this.watch_grant_state(principal, permission).pipe(
      rx.map(granted_by)
    );
  }

  /* Which datasets a principal holds a permission on, as
   * `{ ok, changed }`. This is the one place the rule is written down;
   * watch_allowed and the notify views read it from here.
   *
   * `ok(id, device)` is the answer for dataset `id`, where `device` is
   * the device the dataset is the default dataset of, or null or
   * undefined when it is no valid default dataset. A grant on the
   * dataset allows it. So does UseDevice on the device, for the
   * permissions in DEVICE_PERMS; APIv1.check_dataset_acl is the single
   * check that must agree with this.
   *
   * READ_STRUCTURE stands for "may read the structure": EditDataset on
   * the dataset, or UseDevice on the device of a default dataset.
   *
   * `changed` is a native Set of the datasets whose answer can differ
   * from the value before. It is null on the first value, and when a
   * grant on every target came or went: then any answer can differ. */
  watch_allowed_check(principal, permission) {
    const structure = permission == READ_STRUCTURE;
    const by_device = structure || DEVICE_PERMS.has(permission);
    const direct = this.watch_grant_state(principal,
      structure ? Constants.Perm.EditDataset : permission);

    const grants = by_device
      ? rx.combineLatest({
          direct,
          device: this.watch_grant_state(principal, Constants.Perm.UseDevice),
        })
      : direct.pipe(rx.map(state => ({ direct: state, device: null })));

    return rx.defer(() => {
      let held = null;

      return grants.pipe(
        rx.map(now => {
          const is_direct = granted_by(now.direct);
          const use_device = now.device && granted_by(now.device);
          const ok = use_device
            ? (id, device) =>
                is_direct(id) || (device != null && use_device(device))
            : id => is_direct(id);

          const changed = held == null ? null : grant_changes(held, now);
          held = now;
          return { ok, changed };
        })
      );
    });
  }

  /* Which datasets a principal holds a permission on, as a predicate
   * over the dataset UUID alone. watch_allowed_check has the rule. */
  watch_allowed(principal, permission) {
    if (permission != READ_STRUCTURE && !DEVICE_PERMS.has(permission))
      return this.watch_granted(principal, permission);

    return rx.combineLatest([
      this.watch_allowed_check(principal, permission),
      this.default_devices,
    ]).pipe(
      rx.map(([{ ok }, devices]) => id => ok(id, devices.get(id)))
    );
  }

  filter_allowed_datasets(principal, permission) {
    const allowed = this.watch_allowed(principal, permission);

    return source => source.pipe(
      rx.combineLatestWith(allowed),

      rx.map(([datasets, ok]) =>
        datasets.filter(
          (_, datasetId) => ok(datasetId)
        )
      )
    );
  }

  select_dataset_uuids() {
    return source => source.pipe(
      rx.map(datasets => datasets.keySeq())
    );
  }

  /*
   * -----------------------------------------------
   * Public composed streams
   * ---------------------------------------------------
   */

  allowed_valid_datasets(principal, permission) {
    return this.valid_datasets.pipe(
      this.filter_allowed_datasets(
        principal,
        permission
      )
    );
  }

  allowed_valid_dataset_uuids(principal, permission) {
    return this.valid_datasets.pipe(
      this.filter_allowed_datasets(
        principal,
        permission
      ),

      this.select_dataset_uuids()
    );
  }

  allowed_invalid_datasets(principal, permission) {
    return this.invalid_datasets.pipe(
      this.filter_allowed_datasets(
        principal,
        permission
      )
    );
  }

  allowed_invalid_dataset_uuids(principal, permission) {
    return this.invalid_datasets.pipe(
      this.filter_allowed_datasets(
        principal,
        permission
      ),

      this.select_dataset_uuids()
    );
  }

  allowed_all_datasets(principal, permission) {
    return this.datasets.pipe(
      this.filter_allowed_datasets(
        principal,
        permission
      )
    );
  }

  allowed_all_dataset_uuids(principal, permission) {
    return this.datasets.pipe(
      this.filter_allowed_datasets(
        principal,
        permission
      ),

      this.select_dataset_uuids()
    );
  }

  /*
   * ------------------------------------------------
   * Parts
   * ------------------------------------------------
   */

  allowed_dataset_parts(
    dataset_uuid,
    principal,
    permission
  ) {
    return rx.combineLatest([
      this.parts,
      this.watch_allowed(principal, permission)
    ]).pipe(
      rx.map(([partsMap, ok]) => {
        const parts =
          partsMap.get(dataset_uuid);

        if (!parts)
          return [];

        return parts.filter(partId => ok(partId));
      }),

      rxu.shareLatest()
    );
  }

  /*
   * --------------------------------------------------
   * Watch Dataset's members' subclasses
   * ----------------------------------------------------
   */

  _build_parts() {
    return rxu.rx(
      rx.combineLatest([
        this.cdb.watch_members_subclasses(
          Constants.Class.Dataset
        ),

        this.cdb.watch_members(
          Constants.Class.Dataset
        )
      ]),

      rx.map(([subclassesMap, datasetMembers]) =>
        subclassesMap.map(
          subclass_uuids =>
            subclass_uuids.filter(
              x => datasetMembers.has(x)
            )
        )
      ),

      rxu.shareLatest()
    );
  }

  /*
   * ----------------------------------------------------
   * Functional types
   * ----------------------------------------------------
   */

  /* Functional group -> its members, turned round: dataset -> the
   * groups it is in. A list that did not change stays the same object,
   * and `changed` names the datasets whose list did. */
  _build_functional_changes() {
    return rx.defer(() => {
      let held = null;

      return this.cdb.watch_member_members(
        Constants.Group.FunctionalDatasetGroup
      ).pipe(
        rx.map(data => {
          let result = IMap();

          data.forEach((memberIds, groupId) => {
            memberIds.forEach(memberId => {
              result = result.update(
                memberId,
                list =>
                  list
                    ? list.push(groupId)
                    : IList([groupId])
              );
            });
          });

          return result;
        }),

        rx.map(next => {
          if (held == null) {
            held = next;
            return { map: next, changed: null };
          }

          const changed = new Set();
          const map = next.map((list, memberId) => {
            const old = held.get(memberId);
            if (old !== undefined && imm_is(old, list)) return old;
            changed.add(memberId);
            return list;
          });
          for (const memberId of held.keys())
            if (!next.has(memberId)) changed.add(memberId);

          if (changed.size == 0) return null;
          held = map;
          return { map, changed };
        }),

        rx.filter(change => change != null)
      );
    }).pipe(
      rxu.shareLatest()
    );
  }

  /*
   * -----------------------------------------------------
   * Generic app config builder
   * ----------------------------------------------------
   */

  /* The entries of every application in a class, one change at a
   * time. An application that joins the class costs one SEARCH; the
   * others are left alone. */
  _watch_apps(app_klass) {
    return this.cdb.watch_members(app_klass).pipe(
      watch_each(appId => this.cdb.search_app_changes(appId))
    );
  }

  /* object -> application -> config for a class of applications, as
   * `{ map, changed }`. Nothing is emitted until every application
   * has answered. */
  _build_app_changes(app_klass) {
    return rx.defer(() => {
      const configs = new AppConfigs();

      return this._watch_apps(app_klass).pipe(
        rx.map(event => configs.apply(event)),
        rx.filter(change => change != null)
      );
    }).pipe(
      rxu.shareLatest()
    );
  }

  /*
   * --------------------------------------------------
   * General info
   * ------------------------------------------------
   */

  _build_info_changes() {
    return rx.defer(() => {
      const infos = new AppMap();

      return this.cdb.search_app_changes(
        UUIDs.App.Info
      ).pipe(
        rx.map(change => infos.apply(change)),
        rx.filter(change => change != null)
      );
    }).pipe(
      rxu.shareLatest()
    );
  }

  /*
   * -------------------------------------------------
   * Dataset builder
   * -------------------------------------------------
   */

  /* The dataset map and the maps derived from it, as
   * `{ datasets, valid, invalid, defaults, changed }`. A change to a
   * structure entry works out that dataset and the datasets that
   * refer to it again, and no other. DatasetIndex has the rules. */
  _build_changes() {
    return rx.defer(() => {
      const index = new DatasetIndex();
      this.index = index;

      return this._build_app_changes(
        Constants.App.DatasetDefinition
      ).pipe(
        rx.map(({ map, changed }) => index.apply(map, changed)),
        rx.filter(change => change != null)
      );
    }).pipe(
      rxu.shareLatest()
    );
  }

  /* The default device datasets, as a native Map from dataset UUID to
   * the device it reads, worked out from the whole dataset map.
   * `default_devices` no longer comes from this: DatasetIndex keeps
   * the same entries up to date one change at a time. */
  _build_default_devices() {
    return rxu.rx(
      this.datasets,

      rx.map(datasets => {
        const devices = new Map();
        for (const [uuid, dataset] of datasets) {
          const device = default_dataset_device(uuid, dataset);
          if (device) devices.set(uuid, device);
        }
        return devices;
      }),

      rxu.shareLatest()
    );
  }
}
