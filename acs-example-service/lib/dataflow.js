import { RxClient, UUIDs } from '@amrc-factoryplus/rx-client';

export class DataFlow {
  constructor(opts) {
    const { fplus } = opts;

    this.root = opts.root_principal;

    this.log = fplus.debug.bound("data");
    this.cdb = fplus.ConfigDB;

    /* Requests to update the database */
    this.requests = new rx.Subject();
    /* Responses to these requests */
    this.responses = this._build_responses();

    this.names = this._build_names();
  }

  update_name(r) {
    // Something like this but returning an HTTP-like response. (put_config returns an exception that needs catching)
    this.cdb.put_config(UUIDs.App.Info, r.object, { name: r.name });
  };

  _build_names() {
    return rxx.rx(
      cdb.search_app(UUIDs.App.Info),
      // rx.map acts on the sequence of responses, entries.map acts on the entries maps
      rx.map(entries => entries.map(entry => entry.name)),
      // Cache the map (1 refers to 1 previous value)
      rx.shareReplay(1));
  }

  _build_responses() {

    const updaters = {
      // This tells you what to do with a "name" type object
      // UUIDs.App.Info == "General Information" application
      name: this.update_name,
    };

    return rxx.rx(this.requests,
      rx.mergeMap(r => {
        const updater = updaters[r.type]
          ?? (async () => ({ status: 500 }));

        return updater.call(this, r)
          .then(rv => ({ ...rv, type: r.type, request: r.request }));
      }),
      rx.share());
  }


  run() {
    this.groups.subscribe(gs => this.log("GROUPS UPDATE"));
    //imm.Map(gs).toJS()));
    this.grants.subscribe(es => this.log("GRANT UPDATE"));
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
