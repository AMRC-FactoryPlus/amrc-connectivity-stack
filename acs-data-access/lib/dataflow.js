/*
* ACS Data Access Service
* Data-Flow / sequence management
*/

import imm from "immutable";
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

    this.metadata = this._build_metadata();
  }

  _build_metadata() {
    return rxx.rx(
      rx.combineLatest([
          this.cdb.search_app(Constants.App.SessionLimits),
          this.cdb.search_app(Constants.App.UnionComponents)
      ]),
      rx.map(([sessions, unions]) => {
        const sessionDatasets = sessions.keySeq().toList();

        const unionDatasets = unions
          .valueSeq()     // all arrays
          .flatten()      // flatten arrays
          .toSet()        // dedupe
          .toList();

        return imm.Map({
          [Constants.Class.Session]: sessionDatasets,
          [Constants.Class.Union]: unionDatasets,
        });
      }),

      rxx.shareLatest()
    );
  }


  run() {
    this.metadata.subscribe(ss => this.log("METADATA UPDATE %o", ss.toJS()));
    
  }


  // Track list of datasets for principal with permission
  track_metadata(principal, permission){
    
  }


  find_metadata(principal){

  }
}
