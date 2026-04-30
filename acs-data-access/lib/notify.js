/*
* ACS Data Access Service
* DataAccessNotify
*/

import * as rx from "rxjs";

import * as rxx from "@amrc-factoryplus/rx-util";
import { Notify } from "@amrc-factoryplus/service-api";

export class DataAccessNotify {
  constructor(opts) {
    this.data = opts.data;
    this.log = opts.debug.bound("notify");
    this.notify = this.build_notify(opts.api);
  }

  run() {
    this.log("Running Data Access Notify Server");
    this.notify.run();
  }

  build_notify(api) {
    const notify = new Notify({
      api,
      log: this.log,
    });

    notify.watch("v1/metadata/", this.metadata_list.bind(this));
    notify.watch("v1/metadata/:uuid", this.metadata_uuid.bind(this));
    notify.search("v1/metadata/", this.metadata_search.bind(this));
    
    notify.watch("v1/structure/", this.structure_list.bind(this));
    notify.watch("v1/structure/:uuid", this.structure_uuid.bind(this));
    notify.search("v1/structure/", this.structure_search.bind(this));

    return notify;
  }

  metadata_list(sess){
    
  }

  metadata_uuid(sess){

  }

  metadata_search(sess){

  }

  structure_list(sess){

  }

  structure_uuid(sess){

  }
  
  structure_search(sess){

  }

  /**
  * Get names for all objects the principal can see.
  */
  name_list(sess) {
    // We should combine this with the session permissions to see the objects
    return rxx.rx(
      this.data.names,
      rx.map(entries => entries.keySeq().toArray()),
      rx.mergeMap(
        // You need to filter out what they can't see here using `sess` (not in a .filter :))
      ),
      rx.map(
        // You need to build your response objects here
      ));
  }
}
