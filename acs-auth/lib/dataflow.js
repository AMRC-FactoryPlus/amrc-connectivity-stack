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
        const { cdb, aces } = this;

        const target_groups = rxx.rx(
            aces,
            rx.tap(v => this.log("TARG GRP: got ACEs")),
            rx.map(es => imm.Seq(es)
                .filter(e => e.plural)
                .map(e => e.target)
                .toSet()),
            rx.tap(gs => this.log("TARG GRPs: %o", gs)));

        return rxx.rx(
            rx.combineLatest({
                princ:      cdb.watch_members(Class.Principal),
                princ_grp:  cdb.watch_powerset(Class.Principal),
                perm:       cdb.watch_members(Class.Permission),
                perm_grp:   cdb.watch_powerset(Class.Permission),
                targ_grp:   rxx.rx(
                    cdb.expand_members(target_groups),
                    rx.tap(gs => this.log("TARG GRPs: got members"))),
            }),
            rx.shareReplay(1));
    }

    run () {
        this.groups.subscribe(gs => this.log("GROUPS UPDATE"));
            //imm.Map(gs).toJS()));
        this.aces.subscribe(es => this.log("ACE UPDATE"));
    }

    acl_for (principal) {
        return rxx.rx(
            rx.combineLatest({
                groups:     this.groups,
                aces:       this.aces,
            }),
            rx.tap(v => this.log("ACL UPDATE: %s", principal)),
            rx.map(({ groups, aces }) => {
                if (!groups.princ.has(principal))
                    return;
                /* Find principals we will accept in an ACE */
                const accept_princ = groups.princ_grp
                    .filter(ms => ms.has(principal))
                    .keySeq()
                    .concat(principal)
                    .toSet();
                return aces
                    /* Filter ACEs by principal or group */
                    .filter(e => accept_princ.has(e.principal))
                    /* Expand composite permissions */
                    .flatMap(e => 
                        groups.perm.has(e.permission) ? [e]
                        : groups.perm_grp.has(e.permission) ?
                            groups.perm_grp.get(e.permission)
                                .toArray()
                                .map(m => ({ ...e, permission: m }))
                        : [])
                    /* Expand target groups */
                    .flatMap(e => e.plural
                        /* We may not have the members of this group
                         * yet. We'll get another update later. */
                        ? groups.targ_grp.has(e.target)
                            ? groups.targ_grp.get(e.target)
                                .toArray()
                                .map(m => ({ ...e, target: m }))
                            : []
                        : [e])
                    /* Substitute Self and remove unwanted properties */
                    .map(e => ({
                        permission: e.permission,
                        target:     e.target == Special.Self ? principal : e.target,
                    }));
            }));
    }
}
