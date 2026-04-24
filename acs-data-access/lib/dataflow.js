/*
* ACS Data Access Service
* Data-Flow / sequence management
*/

import { List as IList, Map as IMap } from "immutable";
import rx from "rxjs";

import * as rxx     from "@amrc-factoryplus/rx-util";

import { DataAccess as Constants }  from './constants.js';
import { valid_uuid, valid_krb, DatasetValidity }    from "./validate.js";
import { RxClient, UUIDs } from '@amrc-factoryplus/rx-client';

export class DataFlow {
  constructor(opts) {
    const { fplus } = opts;

    this.log = fplus.debug.bound("data");
    this.cdb = fplus.ConfigDB;
    this.auth = fplus.Auth;

    this.dataset_definitions = this._build_dataset_definitions();
    this.general_infos = this._build_general_info();
    this.metadata = this._build_metadata();
    this.functional_types = this._build_functional_types();
  }

  run() {
    // this.dataset_definitions.subscribe(ss => 
    //   this.log("Dataset Definitions UPDATE %o", ss.toJS())
    // );

    // this.log("GENERAL INFO UUID: ", UUIDs.App.Info);
    // this.general_infos.subscribe(x => this.log("General infos UPDATE %o", x.toJS()));
    
  }

  // Watch member members of functional group to see what functional type datasets have
  _build_functional_types() {
    return rxx.rx(
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
      rxx.shareLatest()
    );
  }

  _build_metadata() {
    return rxx.rx(
      this.cdb.watch_members(Constants.App.DatasetMetadata),

      rx.switchMap((uuidsSet) => {
        const uuids = uuidsSet.toArray();

        if (uuids.length === 0) {
          return rx.of(IMap());
        }

        const streams = uuids.map(uuid =>
          this.cdb.search_app(uuid).pipe(
            rx.map(result => [uuid, result])
          )
        );

        return rx.combineLatest(streams).pipe(
          rx.map(entries => {
            let map = IMap();

            for (const [outerUuid, result] of entries) {
              for (const [innerUuid, payload] of result) {
                const existing = map.get(innerUuid, IMap());

                map = map.set(innerUuid, existing.set(outerUuid, payload));
              }
            }

            return map;
          })
        );
      }),
      rxx.shareLatest()
    );
  }
  
  
  _build_general_info(){
    return rxx.rx(
      this.cdb.search_app(UUIDs.App.Info), 
      rxx.shareLatest()
    );
  }

  _build_dataset_definitions() {
    return rxx.rx(
      rx.combineLatest([
        this.cdb.search_app(Constants.App.SparkplugSrc),
        this.cdb.search_app(Constants.App.SessionLimits),
        this.cdb.search_app(Constants.App.UnionComponents)
      ]),

      rx.switchMap(([sprkDevices, sessions, unions]) => {
        const grouped = IMap({
          [Constants.App.SessionLimits]: sessions,
          [Constants.App.UnionComponents]: unions,
          [Constants.App.SparkplugSrc]: sprkDevices
        });

        return rx.from(grouped.entrySeq()).pipe(
          // Flatten all datasets across all apps
          rx.mergeMap(([structure, datasets]) =>
            rx.from((datasets || IMap()).entrySeq()).pipe(
              rx.map(([datasetId, config]) => ({
                datasetId,
                definition: { structure, config }
              }))
            )
          ),

          // Group into: { datasetId: [definitions] }
          rx.reduce((acc, { datasetId, definition }) => {
            const existing = acc.get(datasetId, []);
            return acc.set(datasetId, [...existing, definition]);
          }, IMap())
        );
      }),

      rxx.shareLatest()
    );
  }

  get_functional_types(){
    return this.functional_types;
  }

  get_metadata(){
    return this.metadata;
  }

  get_general_infos(){
    return this.general_infos;
  }


  async get_allowed_dataset_uuids(principal, permission, dataset_validity) {
    const dataset_def_obs = this.get_dataset_definitions(dataset_validity);
    
    const result = await rx.firstValueFrom(
      rx.combineLatest([
        dataset_def_obs,
        this.auth.watch_acl_with_perm(principal, permission)
      ]).pipe(
        rx.map(([datasets, targets]) => {
          // datasets: IMap<datasetId, {...}>
          // targets: Set or ISet of allowed datasetIds

          return datasets
            .keySeq()                // get all dataset IDs
            .filter(id => targets.has(id))
            .toArray();              // convert to plain array
        })
      )
    );

    return result;
  }


  async get_dataset_def_by_uuid(uuid){
    const def = await rx.firstValueFrom(
      this.get_dataset_definitions(DatasetValidity.VALID).pipe(
        rx.map(datasets => datasets.get(uuid)?.[0])
      )
    );
    return def;
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
    return this.dataset_definitions;
  }

  _get_valid_dataset_definitions() {
    return this.dataset_definitions.pipe(
      rx.map((map) =>
        map.filter((definitions) => definitions.length === 1)
      )
    );
  }

  _get_invalid_dataset_definitions() {
    return this.dataset_definitions.pipe(
      rx.map((map) =>
        map.filter((definitions) => definitions.length > 1)
      )
    );
  }
}