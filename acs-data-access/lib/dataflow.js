/*
* ACS Data Access Service
* Data-Flow / sequence management
*/

import { Map as IMap } from "immutable";
import rx from "rxjs";

// import { UUIDs }    from "@amrc-factoryplus/service-client";
import * as rxx     from "@amrc-factoryplus/rx-util";
import { Optional, Response } from "@amrc-factoryplus/rx-util";

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

  _build_dataset_definitions() {
    return rxx.rx(
      rx.combineLatest([
        this.cdb.search_app(Constants.App.SessionLimits),
        this.cdb.search_app(Constants.App.UnionComponents)
      ]),
      rx.map(([sessions, unions]) => {
        return IMap({
          [Constants.Class.Session]: sessions,
          [Constants.Class.Union]: unions,
        });
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