/*
* ACS Data Access Service
* Data-Flow / sequence management
*/
import rx from 'rxjs';

import * as rxx     from "@amrc-factoryplus/rx-util";
import { RxClient, UUIDs } from '@amrc-factoryplus/rx-client';

import { DataAccess } from './constants.js';




export class DataFlow {
  constructor(opts) {
    const { fplus } = opts;

    this.log = fplus.debug.bound("data");
    this.cdb = fplus.ConfigDB;
    this.auth = fplus.Auth;

    /* Requests to update the database */
    /* it's a subject which means we can push values down the sequence. That is driven from requests to the api to make changes.
    All the rest are driven from external sources of data (db or ConfigDB).  
    */ 
   /**
    * for the DataFlow service we'd want to think about what sources of
    * information we need to track from the configDB and we start building sequences that track that information and transform it into forms that are useful to us. 
    */
    this.requests = new rx.Subject(); 
    /* Responses to these requests */
    this.responses = this._build_responses();
    this.metadata = this._build_metadata();

    // combine these into map ??? with key = structural dataset class UUID
    this.sessions = this.cdb.search_app(DataAccess.App.SessionLimits);
    this.unions = this.cdb.search_app(DataAccess.App.UnionComponents);


    // this.names = this._build_names();
  }


  _build_metadata(){

  }

  update_name(r) {
    // Something like this but returning an HTTP-like response. (put_config returns an exception that needs catching)
    this.cdb.put_config(UUIDs.App.Info, r.object, { name: r.name });
  };

  
  _build_names() {
    return rxx.rx(
      this.cdb.search_app(UUIDs.App.Info),
      // rx.map acts on the sequence of responses, entries.map acts on the entries maps
      rx.map(entries => entries.map(entry => entry.name)),
      // Cache the map (1 refers to 1 previous value)
      rx.shareReplay(1));
  }



  _build_responses() {
    // this obj is a map from request type to a method that handles this request. 
    const updaters = {
      // This tells you what to do with a "name" type object
      // UUIDs.App.Info == "General Information" application
      name: this.update_name,
    };

    /**
     * the processing loop that actually does the work which takes the sequence of requests that are coming in from the method down below where it pushes to the subject. And then each time we get a new request it looks up how we perform this request, it actually performs it with updater. 
     * If we get a request that we don't have an updater for -> just return 500. If exists -> we call the updater.
     */
    return rxx.rx(this.requests,
      rx.mergeMap(r => {
        const updater = updaters[r.type]
          ?? (async () => ({ status: 500 }));

        return updater.call(this, r)
          .then(rv => ({ ...rv, type: r.type, request: r.request }));
      }),
      rx.share());
  }
                                                                                                                                             
  /**
   * This function tells the data flow to start subscribing to things and making things happen.  
   */
  run() {
    this.sessions.subscribe(ss => this.log("SESSION UPDATE %o", ss.toJS()));
    this.unions.subscribe(ss => this.log("UNION UPDATE %o", ss.toJS()));

  }





  /** Request a change to the database.
   *
   * This submits a change request to the database and returns a
   * Promise containing an HTTP status code for the outcome. If a
   * change is made then the change will also be published to
   * `updates`.
   *
   * @param r A request object. Must contain a `kind` field.
   * @returns A response object containing a `status` field.
   */
  // The actual processing of the request happens in the _build_responses method that builds the sequence. 
  request(r) {
    const request = uuidv4();
    /* Construct the Promise to the response before we send the
     * request. This avoids a race condition. */
    const response = rx.firstValueFrom(rxx.rx(
      this.responses,
      rx.filter(r => r.request == request)));
    this.requests.next({ ...r, request });
    return response;
  }
}
