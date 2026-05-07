/*
* ACS Data Access Service
* Data-Flow / sequence management
*/

import { List as IList, Map as IMap, Set as ISet } from "immutable";
import rx from "rxjs";

import * as rxu     from "@amrc-factoryplus/rx-util";

import { DataAccess as Constants }  from './constants.js';
import { valid_uuid, valid_krb, DatasetValidity }    from "./validate.js";
import { RxClient, UUIDs } from '@amrc-factoryplus/rx-client';
import { minDate, maxDate } from './utils.js';

export class DataFlow {
  constructor(opts) {
    this.log = opts.debug.bound("data");
    this.cdb = opts.cdb;
    this.auth = opts.auth;

    this.datasets = this._build_datasets();
    this.general_infos = this._build_general_info();
    this.metadata = this._build_metadata();
    this.functional_types = this._build_functional_types();
    this.parts = this._build_parts();
  }

  run() {
    // this.dataset_definitions.subscribe(ss => 
    //   this.log("Dataset Definitions UPDATE %o", ss.toJS())
    // );

    // this.log("GENERAL INFO UUID: ", UUIDs.App.Info);
    // this.general_infos.subscribe(x => this.log("General infos UPDATE %o", x.toJS()));
    // this.parts.subscribe(x => this.log("Parts UPDATE %o", x.toJS()));
  }

  // watch Dataset's members' subclasses
  _build_parts() {
    return rxu.rx(
      rx.combineLatest([
        this.cdb.watch_members_subclasses(Constants.Class.Dataset),
        this.cdb.watch_members(Constants.Class.Dataset)
      ]),
      rx.map(([subclassesMap, datasetMembers]) => subclassesMap.map(
        subclass_uuids => subclass_uuids.filter(x => datasetMembers.has(x))
      )),
      rxu.shareLatest()
    );
  }

  // Watch member members of functional group to see what functional type datasets have
  _build_functional_types() {
    return rxu.rx(
      this.cdb.watch_member_members(Constants.Group.FunctionalDatasetGroup),
      rx.map(data => {
        let result = IMap();

        data.forEach((memberIds, groupId) => {
          memberIds.forEach(memberId => {
            result = result.update(
              memberId,
              list => (list ? list.push(groupId) : IList([groupId]))
            );
          });
        });

        return result;
      }),
      rxu.shareLatest()
    );
  }

  _build_apps_configs(app_klass){
    return rxu.rx(
          this.cdb.watch_members(app_klass),

          rx.switchMap((membersSet) => {
            const appUuids = membersSet.toArray();

            if (appUuids.length === 0) {
              return rx.of(IMap());
            }

            const dataStreams = appUuids.map(appId =>
              this.cdb.search_app(appId).pipe(
                rxu.shareLatest(),
                rx.map(config => [appId, config])
              )
            );

            return rx.combineLatest(dataStreams).pipe(
              rx.map(appEntries => {
                let result = IMap();

                for (const [appId, config] of appEntries) {
                  for (const [datasetId, payload] of config) {
                    const existing = result.get(datasetId, IMap());

                    result = result.set(datasetId, existing.set(appId, payload));
                  }
                }

                return result;
              })
            );
          }),
          rxu.shareLatest()
        );
  }

  _build_metadata() {
    return this._build_apps_configs(Constants.App.DatasetMetadata);
  }
  
  
  _build_general_info(){
    return rxu.rx(
      this.cdb.search_app(UUIDs.App.Info), 
      rxu.shareLatest()
    );
  }



  /*
    1. search structure apps for all dataset configs
    2. invalid if exists in more than one structural app
    3. invalid if contains self-referencing source or invalid source
    4. if invalid throw away the definition and create a new one with the same dataset_uuid but structure = Constants.Special.InvalidDataset
  */
  _build_datasets() {
    return rxu.rx(
      this._build_apps_configs(Constants.App.DatasetDefinition),

      rx.map((groupedConfigs) => {

        // ----------------------------
        // 1. Normalise duplicates
        // ----------------------------
        //
        // Convert:
        //
        // datasetId => IMap({
        //   appId => payload
        // })
        //
        // into:
        //
        // datasetId => {
        //   structure,
        //   config
        // }
        //
        // or INVALID if multiple definitions exist
        //

        let map = groupedConfigs.map((definitions) => {
          const entries = definitions.entrySeq().toArray();

          if (entries.length !== 1) {
            return {
              structure: Constants.Special.InvalidDataset,
              config: null
            };
          }

          const [structure, config] = entries[0];

          return {
            structure,
            config
          };
        });

        // ----------------------------
        // 2. Recursive resolution (cached)
        // ----------------------------

        const cache = new Map();

        const resolve = (datasetId, visited = new Set()) => {
          if (cache.has(datasetId))
            return cache.get(datasetId);

          if (visited.has(datasetId)) {
            const result = {
              validity: DatasetValidity.INVALID,
              from: null,
              to: null,
              error: "Cycle detected"
            };

            cache.set(datasetId, result);
            return result;
          }

          visited.add(datasetId);

          const def = map.get(datasetId);

          if (!def ||
              def.structure === Constants.Special.InvalidDataset) {

            const result = {
              validity: DatasetValidity.INVALID,
              from: null,
              to: null
            };

            cache.set(datasetId, result);
            return result;
          }

          const { structure, config } = def;

          // ------------------------
          // SESSION
          // ------------------------

          if (structure === Constants.App.SessionLimits) {
            const child = resolve(config.source, new Set(visited));

            if (child.validity === DatasetValidity.INVALID) {
              cache.set(datasetId, child);
              return child;
            }

            const from = config.from
              ? new Date(config.from)
              : null;

            const to = config.to
              ? new Date(config.to)
              : null;

            const result = {
              validity: DatasetValidity.VALID,
              from: maxDate(from, child.from),
              to: minDate(to, child.to)
            };

            cache.set(datasetId, result);
            return result;
          }

          // ------------------------
          // SPARKPLUG
          // ------------------------

          if (structure === Constants.App.SparkplugSrc) {
            const result = {
              validity: DatasetValidity.VALID,
              from: null,
              to: null
            };

            cache.set(datasetId, result);
            return result;
          }

          // ------------------------
          // UNION
          // ------------------------

          if (structure === Constants.App.UnionComponents) {
            const children = config.map(id =>
              resolve(id, new Set(visited))
            );

            const validChildren = children.filter(
              c => c.validity === DatasetValidity.VALID
            );

            if (validChildren.length !== children.length) {
              const result = {
                validity: DatasetValidity.INVALID,
                from: null,
                to: null
              };

              cache.set(datasetId, result);
              return result;
            }

            const fromTimes = validChildren
              .map(v => v.from?.getTime())
              .filter(t => !isNaN(t));

            const toTimes = validChildren
              .map(v => v.to?.getTime())
              .filter(t => !isNaN(t));

            const result = {
              validity: DatasetValidity.VALID,
              from: fromTimes.length
                ? new Date(Math.min(...fromTimes))
                : null,
              to: toTimes.length
                ? new Date(Math.max(...toTimes))
                : null
            };

            cache.set(datasetId, result);
            return result;
          }

          // ------------------------
          // Fallback
          // ------------------------

          const result = {
            validity: DatasetValidity.INVALID,
            from: null,
            to: null
          };

          cache.set(datasetId, result);
          return result;
        };

        // ----------------------------
        // 3. Resolve all datasets
        // ----------------------------

        return map.map((def, datasetId) => ({
          ...def,
          ...resolve(datasetId)
        }));
      }),

      rxu.shareLatest()
    );
  }

  async get_dataset_allowed_parts(dataset_uuid, principal, permission){
    const result = await rx.firstValueFrom(
      rx.combineLatest([
        this.parts,
        this.auth.watch_acl_with_perm(principal, permission)
      ]).pipe(
        rx.map(([partsMap, allowedParts]) => {
          const parts = partsMap.get(dataset_uuid);

          if(!parts) return [];

          return parts.filter(partId => allowedParts.has(partId));
        })
      )
    );

    return result;
  }

  async get_allowed_dataset_uuids(principal, permission, dataset_validity) {
    const datasets = this.get_dataset_definitions(dataset_validity);
    
    const allowed_datasets = await rx.firstValueFrom(
      rx.combineLatest([
        datasets,
        this.auth.watch_acl_with_perm(principal, permission)
      ]).pipe(
        rx.map(([datasets, targets]) => {
          // datasets: IMap<datasetId, {...}>
          // targets: Set or ISet of allowed datasetIds

          return datasets
            .keySeq()                // get all dataset IDs
            .filter(id => targets.has(id));
        })
      )
    );

    return allowed_datasets;
  }

  get_dataset_definitions(validity){
    if(validity == DatasetValidity.VALID){
      return this._get_valid_dataset_definitions();
    }else if (validity == DatasetValidity.INVALID){
      return this._get_invalid_dataset_definitions();
    }else if(validity == DatasetValidity.ALL){
      return this._get_all_dataset_definitions();
    }else{
      throw Error("Unhandled dataset validity type.");
    }
  }

  _get_all_dataset_definitions(){
    return this.datasets;
  }

  _get_valid_dataset_definitions() {
    return this.datasets.pipe(
      rx.map((map) =>
        map.filter(
          (definition) =>
            definition.structure !== Constants.Special.InvalidDataset
        )
      )
    );
  }

  _get_invalid_dataset_definitions() {
    return this.datasets.pipe(
      rx.map((map) =>
        map.filter(
          (definition) =>
            definition.structure === Constants.Special.InvalidDataset
        )
      )
    );
  }
}