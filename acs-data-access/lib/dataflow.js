/*
* ACS Data Access Service
* Data-Flow / sequence management
*/

import { Map as IMap } from "immutable";
import rx from "rxjs";

import * as rxx     from "@amrc-factoryplus/rx-util";

import { DataAccess as Constants }  from './constants.js';
import { valid_uuid, valid_krb }    from "./validate.js";


export class DataFlow {
  constructor(opts) {
    const { fplus } = opts;

    this.log = fplus.debug.bound("data");
    this.cdb = fplus.ConfigDB;
    this.auth = fplus.Auth;

    this.dataset_definitions = this._build_dataset_definitions();
  }

  // Todo: check if dataset is duplicated (in all unions, session, sparkplug) -> set as invalid dataset
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
          rx.mergeMap(([structure, datasets]) =>
            rx.from((datasets || IMap()).entrySeq()).pipe(
              rx.map(([datasetId, config]) => ({
                datasetId,
                value: { structure, config }
              }))
            )
          ),
          rx.reduce((acc, { datasetId, value }) => acc.set(datasetId, value), IMap())
        );
      }),

      rxx.shareLatest()
    );
  }

  get_dataset_definitions(){
    return this.dataset_definitions;
  }

  run() {
    this.dataset_definitions.subscribe(ss => 
      this.log("Dataset Definitions UPDATE %o", ss.toJS())
    );
  }
}