/*
 * ACS MES Collation
 * Change-notify WS interface
 */

import * as rx  from "rxjs";

import * as rxx from "@amrc-factoryplus/rx-util";
import { Notify } from "@amrc-factoryplus/service-api";

export class MESNotify {
    constructor (opts) {
        this.auth   = opts.auth;
        this.model  = opts.model;
        this.log    = opts.debug.bound("notify");

        this.notify = this.build_notify(opts.api);
    }

    build_notify (api) {
        const notify = new Notify({
            api,
            log: this.log,
        });

        /* XXX Register watch/search handlers here, e.g.:
         *
         * notify.watch("v1/resource/:id", this.single_resource.bind(this));
         * notify.watch("v1/resource/", this.resource_list.bind(this));
         * notify.search("v1/resource/", this.resource_search.bind(this));
         */

        return notify;
    }

    run () { this.notify.run(); }
}
