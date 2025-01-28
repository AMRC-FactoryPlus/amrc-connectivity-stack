/*
 * ACS Auth service
 * Data-flow / sequence management
 * Copyright 2025 University of Sheffield AMRC
 */

import imm from "immutable";
import rx from "rxjs";
import { v4 as uuidv4 } from "uuid";

import * as rxx from "@amrc-factoryplus/rx-util";

import { Class, Special } from "./uuids.js";

export class DataFlow {
    constructor (opts) {
        const { fplus } = opts;

        this.model = opts.model;

        this.log = fplus.debug.bound("data");
        this.cdb = fplus.ConfigDB;

        /* Requests to update the database */
        this.requests = new rx.Subject();
        /* Responses to these requests */
        this.responses = this._build_responses();

        this.aces = this._build_aces();
        this.groups = this._build_groups();
    }

    _build_responses () {
        const { model } = this;
        return rxx.rx(this.requests,
            rx.mergeMap(r => {
                const updater = 
                    r.kind == "grant"   ? model.grant_request
                    : async () => ({ status: 500 });

                return updater.call(model, r)
                    .then(rv => ({ ...rv, request: r.request }));
            }));
    }

    _build_aces () {
        return rxx.rx(
            rx.defer(() => this.model.grant_get_all()),
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
    request (r) {
        const request = uuidv4();
        /* Construct the Promise to the response before we send the
         * request. This avoids a race condition. */
        const response = rx.firstValueFrom(rxx.rx(
            this.responses,
            rx.filter(r => r.request == request)));
        this.requests.next({ ...r, request });
        return response;
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
