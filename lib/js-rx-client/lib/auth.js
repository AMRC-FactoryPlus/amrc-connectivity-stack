/*
 * Factory+ Rx interface
 * Auth notify
 * Copyright 2025 University of Sheffield
 */

import * as imm from "immutable";
import * as rx from "rxjs";

import { Interfaces, urljoin }  from "@amrc-factoryplus/service-client";
import * as rxx                 from "@amrc-factoryplus/rx-util";

import { NotifyV2 } from "./notify-v2.js";

/** Extended Auth interface class.
 * This supports all the methods from the base Auth service
 * interface as well as methods to access the notify API.
 */
export class Auth extends Interfaces.Auth {
    constructor (fplus) {
        super(fplus);

        /** A NotifyV2 object for the Auth service.
         * @type NotifyV2 */
        this.notify = new NotifyV2(this);
    }

    _watch_acl = rxx.cacheSeq({
        factory:    path => this.notify.watch_full(path),
        replay:     true,
        timeout:    30*60*1000,
    });

    async fetch_raw_acl (path) {
        const res = await rx.firstValueFrom(this._watch_acl(path));
        return [res.status, res.body];
    }

    /**
     * We have not handled bootstrap acls
     * @param {*} principal 
     * @returns 
     */
    watch_acl (principal) {
        const url = urljoin("v2", "acl", "kerberos", principal);
        return rxx.rx(
            this._watch_acl(url),
 
            rx.filter(r => r.status == 200),
            rx.map(r => r.body)
        );
    }

    watch_acl_with_perm (principal, permission) {
        return rxx.rx(
            this.watch_acl(principal), 
            rx.map(arr => 
                arr.filter(x => x.permission == permission)
                    .map(x => x.target)
            ),
            rx.map(arr => new Set(arr))
        );
    }
}
