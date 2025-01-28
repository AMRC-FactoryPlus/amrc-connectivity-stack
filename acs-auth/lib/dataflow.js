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
            rx.map(es => imm.Seq(es)
                .filter(e => e.plural)
                .map(e => e.target)
                .toSet()));

        return rxx.rx(
            rx.combineLatest({
                princ:      cdb.watch_members(Class.Principal),
                princ_grp:  cdb.watch_powerset(Class.Principal),
                perm:       cdb.watch_members(Class.Permission),
                perm_grp:   cdb.watch_powerset(Class.Permission),
                targ_grp:   cdb.expand_members(target_groups),
            }),
            rx.shareReplay(1));
    }

    run () {
        this.groups.subscribe(gs => this.log("GROUPS UPDATE"));
            //imm.Map(gs).toJS()));
        this.aces.subscribe(es => this.log("ACE UPDATE"));
    }

    _acl_for (principal) {
        return rxx.rx(
            rx.combineLatest({
                groups:     this.groups,
                aces:       this.aces,
            }),
            rx.map(({ groups, aces }) => {
                if (!groups.princ.has(principal))
                    return;
                const accept_princ = groups.princ_grp
                    .filter(ms => ms.has(principal))
                    .keySeq()
                    .concat(principal)
                    .toSet();
                const expand = (grp, key, e) => {
                    const ms = groups[grp].get(e[key]);
                    return ms?.toArray()
                        ?.map(m => ({ ...e, [key]: m }))
                        ?? [];
                };
                return aces
                    .filter(e => accept_princ.has(e.principal))
                    .flatMap(e => groups.perm.has(e.permission) ? [e]
                        : expand("perm_grp", "permission", e))
                    .flatMap(e => e.plural ? expand("targ_grp", "target", e) : [e])
                    .map(e => ({
                        permission: e.permission,
                        target:     e.target == Special.Self ? principal : e.target,
                    }));
            }));
    }

    /* These sequences cache the full ACL for a principal. This is not
     * that expensive and doesn't require any additional upstream
     * subscriptions, so cache for half an hour. */
    acl_for = rxx.cacheSeq({
        factory:    p => this._acl_for(p),
        replay:     true,
        timeout:    1800000,
    });
}
