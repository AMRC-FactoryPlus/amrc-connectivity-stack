/* ACS Auth service
 * Change-notify interface
 * Copyright 2025 University of Sheffield AMRC
 */

import deep_equal from "deep-equal";
import * as imm from "immutable";
import * as rx from "rxjs";

import * as rxx                 from "@amrc-factoryplus/rx-util";
import { 
    Notify, WatchFilter, SearchFilter
}  from "@amrc-factoryplus/service-api";

export class AuthNotify extends Notify {
    constructor (opts) {
        super(opts);
        this.data = opts.data;
    }

    build_handlers () {
        return [
            new WatchFilter({
                path:       "v2/principal/",
                handler:    s => this.principal_list(s),
            }),
        ];
//            new SearchFilter({
//                path:       `${vers}/app/:app/object/`,
//                handler:    (s, f, a) => new ConfigWatch(s, a).config_search(f),
//            }),
    }

    principal_list (sess) {
        return rxx.rx(
            this.data.identities,
            rx.map(is => imm.Seq(is)
                .map(i => i.uuid)
                .toSet().toJS()),
            rx.map(body => ({
                status:     200, 
                response:   { status: 200, body },
            })));
    }
}
