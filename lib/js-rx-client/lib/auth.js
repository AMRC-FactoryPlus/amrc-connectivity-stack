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
        factory:    path => this.notify.watch(`v2/acl/${path}`),
        replay:     true,
        timeout:    30*60*1000,
    });

    _fetch_acl (type, principal) {
        const url = type == "uuid" ? urljoin(principal) : urljoin(type, principal);
        return rx.firstValueFrom(this._watch_acl(url));
    }
}
