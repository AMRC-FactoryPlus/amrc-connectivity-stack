/*
 * ACS Auth service
 * Data-flow / sequence management
 * Copyright 2025 University of Sheffield AMRC
 */

import imm from "immutable";
import rx from "rxjs";

import * as rxx from "@amrc-factoryplus/rx-util";

import { Class, Special } from "./uuids.js";

export class DataFlow {
    constructor (opts) {
        const { fplus } = opts;

        this.model = opts.model;

        this.log = fplus.debug.bound("data");
        this.cdb = fplus.ConfigDB;

        this.aces = this._build_aces();
        this.groups = this._build_groups();
    }

    _build_aces () {
        return rxx.rx(
            rx.defer(() => this.model.ace_get_all()),
            rx.shareReplay(1));
    }

    _build_groups () {
        const { cdb } = this;

        return rxx.rx(
            rx.combineLatest({
                princ:      cdb.watch_members(Class.Principal),
                princ_grp:  cdb.watch_powerset(Class.Principal),
                perm:       cdb.watch_members(Class.Permission),
                perm_grp:   cdb.watch_powerset(Class.Permission),
            }),
            rx.shareReplay(1));
    }

    run () {
        this.groups.subscribe(gs => this.log("GROUPS UPDATE"));
            //imm.Map(gs).toJS()));
        this.aces.subscribe(es => this.log("ACES: %o", es));
    }

    acl_for (principal) {
        return rxx.rx(
            rx.combineLatest({
                groups:     this.groups,
                aces:       this.aces,
            }),
            rx.map(({ groups, aces }) => {
                if (!groups.princ.has(principal))
                    return;
                /* Find groups this principal is member of */
                const roles = groups.princ_grp
                    .filter(ms => ms.has(principal))
                    .keySeq().toSet();
                return aces
                    /* Filter ACEs by principal or group */
                    .filter(e => roles.has(e.principal))
                    /* Expand composite permissions */
                    .flatMap(e => 
                        groups.perm.has(e.permission) ? [e]
                        : groups.perm_grp.has(e.permission)
                            ? groups.perm_grp.get(e.permission)
                                .toArray()
                                .map(m => ({ ...e, permission: m }))
                        : [])
                    /* Substitute Self */
                    .map(e => ({
                        ...e,
                        target: e.target == Special.Self ? principal : e.target,
                    }));
            }));
    }
}
