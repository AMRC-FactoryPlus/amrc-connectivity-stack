/*
 * ACS MES Collation
 * Data model / business logic
 */

import * as rx from "rxjs";

export default class Model {
    constructor (opts) {
        this.auth = opts.auth;
        this.fplus = opts.fplus;
        this.log = opts.fplus.debug.bound("model");

        /* Observable of model updates for notify subscribers */
        this.updates = new rx.Subject();
    }

    async init () {
        return this;
    }
}
