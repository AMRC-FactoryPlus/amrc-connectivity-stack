/*
* ACS Data Access Service
* Data-Flow / sequence management
*/

import { List as IList, Map as IMap } from "immutable";
import rx from "rxjs";

import * as rxu from "@amrc-factoryplus/rx-util";

import { DataAccess as Constants } from './constants.js';
import { UUIDs } from '@amrc-factoryplus/rx-client';
import { minDate, maxDate } from './utils.js';

export class DataFlow {
  constructor(opts) {
    this.log = opts.debug.bound("data");
    this.cdb = opts.cdb;
    this.auth = opts.auth;

    this.datasets = this._build_datasets();

    this.valid_datasets = this._build_valid_datasets();

    this.invalid_datasets = this._build_invalid_datasets();

    this.general_infos = this._build_general_info();
    this.metadata = this._build_metadata();
    this.functional_types = this._build_functional_types();
    this.parts = this._build_parts();
  }

  run() {
    // this.datasets.subscribe(ss =>
    //   this.log("Dataset Definitions UPDATE %o", ss.toJS())
    // );
  }

  /*
   * ---------------------------------------------------
   * Rx Operators
   * ---------------------------------------------------
   */

  filter_allowed_datasets(principal, permission) {
    const acls = this.auth.watch_acl_with_perm(
      principal,
      permission
    );

    return source => source.pipe(
      rx.combineLatestWith(acls),

      rx.map(([datasets, targets]) =>
        datasets.filter(
          (_, datasetId) => targets.has(datasetId)
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
      this.auth.watch_acl_with_perm(
        principal,
        permission
      )
    ]).pipe(
      rx.map(([partsMap, allowedParts]) => {
        const parts =
          partsMap.get(dataset_uuid);

        if (!parts)
          return [];

        return parts.filter(
          partId =>
            allowedParts.has(partId)
        );
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

  _build_functional_types() {
    return rxu.rx(
      this.cdb.watch_member_members(
        Constants.Group.FunctionalDatasetGroup
      ),

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

      rxu.shareLatest()
    );
  }

  /*
   * -----------------------------------------------------
   * Generic app config builder
   * ----------------------------------------------------
   */

  _build_apps_configs(app_klass) {
    return rxu.rx(
      this.cdb.watch_members(app_klass),

      rx.switchMap((membersSet) => {
        const appUuids =
          membersSet.toArray();

        if (appUuids.length === 0) {
          return rx.of(IMap());
        }

        const dataStreams =
          appUuids.map(appId =>
            this.cdb.search_app(appId).pipe(
              rxu.shareLatest(),

              rx.map(config => [
                appId,
                config
              ])
            )
          );

        return rx.combineLatest(
          dataStreams
        ).pipe(
          rx.map(appEntries => {
            let result = IMap();

            for (const [appId, config]
              of appEntries) {

              for (const [datasetId, payload]
                of config) {

                const existing =
                  result.get(
                    datasetId,
                    IMap()
                  );

                result = result.set(
                  datasetId,
                  existing.set(
                    appId,
                    payload
                  )
                );
              }
            }

            return result;
          })
        );
      }),

      rxu.shareLatest()
    );
  }

  /*
   * -------------------------------------------------
   * Metadata
   * ---------------------------------------------------
   */

  _build_metadata() {
    return this._build_apps_configs(
      Constants.App.DatasetMetadata
    );
  }

  /*
   * --------------------------------------------------
   * General info
   * ------------------------------------------------
   */

  _build_general_info() {
    return rxu.rx(
      this.cdb.search_app(
        UUIDs.App.Info
      ),

      rxu.shareLatest()
    );
  }

  /*
   * -------------------------------------------------
   * Dataset builder
   * -------------------------------------------------
   */

  _build_datasets() {
    return rxu.rx(
      this._build_apps_configs(
        Constants.App.DatasetDefinition
      ),

      rx.map((groupedConfigs) => {

        /*
        * ------------------------------------------------------------
        * 1. Normalise duplicate definitions
        * ------------------------------------------------------------
        *
        * Convert:
        *
        * datasetId => IMap({
        *   appId => payload
        * })
        *
        * into:
        *
        * datasetId => {
        *   structure,
        *   config
        * }
        *
        * Invalid datasets are represented directly by:
        *
        * structure === Constants.Special.InvalidDataset
        */

        let map = groupedConfigs.map(
          (definitions) => {

            const entries =
              definitions
                .entrySeq()
                .toArray();

            /*
            * Multiple structural definitions
            * => invalid dataset
            */

            if (entries.length !== 1) {
              return {
                structure:
                  Constants.Special.InvalidDataset,

                config: null,
                from: null,
                to: null
              };
            }

            const [structure, config] =
              entries[0];

            return {
              structure,
              config
            };
          }
        );

        /*
        * ------------------------------------------------------------
        * 2. Recursive resolution
        * ------------------------------------------------------------
        *
        * resolve(datasetId)
        *
        * Returns:
        *
        *   { from, to }
        *
        * or:
        *
        *   null
        *
        * where null means invalid.
        */

        const cache = new Map();

        const resolve =
          (datasetId, visited = new Set()) => {

          /*
          * Cached result
          */

          if (cache.has(datasetId))
            return cache.get(datasetId);

          /*
          * Cycle detection
          */

          if (visited.has(datasetId)) {
            cache.set(datasetId, null);
            return null;
          }

          visited.add(datasetId);

          const def =
            map.get(datasetId);

          /*
          * Missing dataset
          */

          if (!def) {
            cache.set(datasetId, null);
            return null;
          }

          /*
          * Already invalid
          */

          if (
            def.structure ===
            Constants.Special.InvalidDataset
          ) {
            cache.set(datasetId, null);
            return null;
          }

          const {
            structure,
            config
          } = def;

          /*
          * --------------------------------------------------
          * SESSION LIMITS
          * --------------------------------------------------
          */

          if (
            structure ===
            Constants.App.SessionLimits
          ) {

            const child =
              resolve(
                config.source,
                new Set(visited)
              );

            /*
            * Invalid child
            */

            if (!child) {
              cache.set(datasetId, null);
              return null;
            }

            const from =
              config.from
                ? new Date(config.from)
                : null;

            const to =
              config.to
                ? new Date(config.to)
                : null;

            const result = {
              from:
                maxDate(
                  from,
                  child.from
                ),

              to:
                minDate(
                  to,
                  child.to
                )
            };

            cache.set(datasetId, result);

            return result;
          }

          /*
          * --------------------------------------------------
          * SPARKPLUG SOURCE
          * --------------------------------------------------
          */

          if (
            structure ===
            Constants.App.SparkplugSrc
          ) {

            const result = {
              from: null,
              to: null
            };

            cache.set(datasetId, result);

            return result;
          }

          /*
          * --------------------------------------------------
          * UNION COMPONENTS
          * --------------------------------------------------
          */

          if (
            structure ===
            Constants.App.UnionComponents
          ) {

            const children =
              config.map(id =>
                resolve(
                  id,
                  new Set(visited)
                )
              );

            /*
            * Any invalid child
            */

            if (children.some(c => !c)) {
              cache.set(datasetId, null);
              return null;
            }

            const fromTimes =
              children
                .map(v =>
                  v.from?.getTime()
                )
                .filter(t =>
                  !isNaN(t)
                );

            const toTimes =
              children
                .map(v =>
                  v.to?.getTime()
                )
                .filter(t =>
                  !isNaN(t)
                );

            const result = {
              from:
                fromTimes.length
                  ? new Date(
                      Math.min(
                        ...fromTimes
                      )
                    )
                  : null,

              to:
                toTimes.length
                  ? new Date(
                      Math.max(
                        ...toTimes
                      )
                    )
                  : null
            };

            cache.set(datasetId, result);

            return result;
          }

          /*
          * --------------------------------------------------
          * Unknown structure
          * --------------------------------------------------
          */

          cache.set(datasetId, null);

          return null;
        };

        /*
        * ------------------------------------------------------------
        * 3. Resolve all datasets
        * ------------------------------------------------------------
        */

        return map.map(
          (def, datasetId) => {

            /*
            * Already invalid due to duplicate defs
            */

            if (
              def.structure ===
              Constants.Special.InvalidDataset
            ) {
              return def;
            }

            const resolved =
              resolve(datasetId);

            /*
            * Invalid dependency graph
            */

            if (!resolved) {
              return {
                structure:
                  Constants.Special.InvalidDataset,

                config: null,
                from: null,
                to: null
              };
            }

            /*
            * Valid dataset
            */

            return {
              ...def,
              ...resolved
            };
          }
        );
      }),

      rxu.shareLatest()
    );
  }

  _build_valid_datasets(){
    return this.datasets.pipe(
      rx.map(map => map.filter(
        def => def.structure !== Constants.Special.InvalidDataset
      )),
      rxu.shareLatest()
    );
  }

  _build_invalid_datasets(){
    return this.datasets.pipe(
      rx.map(map => map.filter(
        def => def.structure === Constants.Special.InvalidDataset
      )),
      rxu.shareLatest()
    );
  }
}


