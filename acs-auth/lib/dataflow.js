/*
 * ACS Auth service
 * Data-flow / sequence management
 * Copyright 2025 University of Sheffield AMRC
 */

import imm from "immutable";
import rx from "rxjs";
import { v4 as uuidv4 } from "uuid";

import { UUIDs }    from "@amrc-factoryplus/service-client";
import * as rxx     from "@amrc-factoryplus/rx-util";
import { Optional, Response } from "@amrc-factoryplus/rx-util";

import { Class, Perm, Special }     from "./uuids.js";
import { valid_uuid, valid_krb }    from "./validate.js";

export class DataFlow {
    constructor (opts) {
        const { fplus } = opts;

        this.model = opts.model;
        this.root = opts.root_principal;

        this.log = fplus.debug.bound("data");
        this.cdb = fplus.ConfigDB;

        /* Requests to update the database */
        this.requests = new rx.Subject();
        /* Responses to these requests */
        this.responses = this._build_responses();

        this.identities = this._build_identities();
        this.grants = this._build_grants();
        this.groups = this._build_groups();
        this.owned = this._build_owned();
    }

    _build_responses () {
        const { model } = this;

        const updaters = {
            dump:       model.dump_request,
            grant:      model.grant_request,
            identity:   model.identity_request,
        };

        return rxx.rx(this.requests,
            rx.mergeMap(r => {
                const updater = updaters[r.type]
                    ?? (async () => ({ status: 500 }));

                return updater.call(model, r)
                    .then(rv => ({ ...rv, type: r.type, request: r.request }));
            }),
            rx.share());
    }

    /* XXX This is not the best way to do this; we refetch the entire
     * grant list every time. We should be able to track the changes
     * made without going back to the database. */
    _track_model (types, fetch) {
        return rxx.rx(
            this.responses,
            rx.filter(r => types.includes(r.type) && r.status < 300),
            rx.startWith(null),
            rx.switchMap(fetch),
            rx.shareReplay(1));
    }

    _build_grants () {
        return this._track_model(
            ["grant", "dump"],
            () => this.model.grant_get_all());
    }

    _build_identities () {
        return this._track_model(
            ["identity", "dump"],
            () => this.model.identity_get_all());
    }

    _build_groups () {
        const { cdb, grants } = this;

        const targ_grp = rxx.rx(
            grants,
            rx.map(es => imm.Seq(es)
                .filter(e => e.plural)
                .map(e => e.target)
                .toSet()),
            cdb.expand_members());

        return rxx.rx(
            rx.combineLatest({
                princ:      cdb.watch_members(Class.Principal),
                princ_grp:  cdb.watch_powerset(Class.Principal),
                perm:       cdb.watch_members(Class.Permission),
                perm_grp:   cdb.watch_powerset(Class.Permission),
                targ_grp,
            }),
            rx.shareReplay(1));
    }

    _build_owned () {
        const { cdb } = this;
        const { App } = UUIDs;

        return rxx.rx(
            cdb.search_app(App.Registration),
            rx.map(es => es.entrySeq()
                .map(([obj, inf]) => [obj, inf.owner])
                .filter(([obj, owner]) => owner != Special.Unowned)
                .groupBy(([obj, owner]) => owner)
                .toMap()
                .map(es => new imm.Set(es.map(e => e[0])))),
            rx.shareReplay(1));
    }

    run () {
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
                grants:     this.grants,
                owned:      this.owned,
            }),
            rx.map(({ groups, grants, owned }) => {
                if (!groups.princ.has(principal))
                    return;
                const accept_princ = groups.princ_grp
                    .filter(ms => ms.has(principal))
                    .keySeq()
                    .concat(principal)
                    .toSet();
                const expand = (e, key, grps) => {
                    const ms = e[key] == Special.Mine
                        ? owned.get(principal) : grps.get(e[key]);
                    return ms?.toArray()
                        ?.map(m => ({ ...e, [key]: m }))
                        ?? [];
                };
                return grants
                    .filter(e => accept_princ.has(e.principal))
                    .flatMap(e => groups.perm.has(e.permission) ? [e]
                        : expand(e, "permission", groups.perm_grp))
                    .flatMap(e => e.plural ? expand(e, "target", groups.targ_grp) : [e])
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

    /** Track the targets for a given principal and permission.
     * @param upn A principal's UPN
     * @param perm A permission UUID
     * @returns A seq of iSets of targets
     */
    track_targets (upn, perm) {
        return rxx.rx(
            this.track_kerberos(upn),
            rx.mergeMap(p => p ? this.acl_for(p) : rx.of([])),
            rx.map(acl => imm.Seq(acl)
                .filter(e => e.permission == perm)
                .map(e => e.target)
                .toSet()),
            rx.tap(ptd => 
                this.log("Permitted %s for %s: %o", perm, upn, ptd.toJS())));
    }

    /** Track a permission, including wildcards.
     * Returns a seq of functions. When the user does not have the given
     * permission at all, emits null. Otherwise emits a function from
     * target to boolean.
     * @param upn The principal UPN
     * @param perm The permission UUID
     * @param wild Whether to treat Special.Wilcard as matching any target
     */
    permitted (upn, perm, wild) {
        if (upn == this.root)
            return rx.of(() => true);

        return rxx.rx(
            this.track_targets(upn, perm),
            rx.map(targs =>
                !targs.size ? null
                : wild && targs.has(Special.Wildcard) ? () => true
                : i => targs.has(i)));
    }
    
    check_targ (upn, perm, wild) {
        return rx.firstValueFrom(this.permitted(upn, perm, wild));
    }

    /** Backend for the `v2/principal` and `identity` endpoints.
     *
     * Searches for identity records matching a given condition. If the
     * condition cannot be satisfied return an empty Optional, otherwise
     * an Optional holding a sequence of Responses. Each successful
     * Response holds an array of identity records.
     *
     * The filter is an object with keys `uuid`, `kind`, `name` and any
     * keys supplied must match.
     *
     * @param upn The requesting principal UPN
     * @param cond A filter to apply to the identity records
     */
    track_identities (upn, cond) {
        cond ??= {};
        if ((cond.uuid && !valid_uuid(cond.uuid))
            || (cond.name && !cond.kind)
            || (cond.kind == "kerberos" && cond.name && !valid_krb(cond.name))
        )
            return Optional.of();

        const props = Object.entries(cond);
        const filtered = rxx.rx(
            this.identities,
            rx.map(ids => 
                ids.filter(id => 
                    props.every(([k, v]) => id[k] == v))));

        /* ReadKrb is repurposed here as 'read any identity' */
        const permitted = this.permitted(upn, Perm.ReadKrb, true);

        return Optional.of(rxx.rx(
            rx.combineLatest(filtered, permitted),
            rx.map(([ids, perm]) => cond.uuid
                ? perm?.(cond.uuid)
                    ? Response.ok(ids)
                    : Response.of(403)
                : perm
                    ? Response.ok(ids.filter(id => perm(id.uuid)))
                    : Response.of(403)),
            rx.map(res => res.filter(ids => ids.length)),
        ));
    }

    /* Pull one entry off `track_identities`.
     *
     * Returns a Response. Nonexistent endpoints return 410.
     */
    find_identities (upn, cond) {
        return this.track_identities(upn, cond)
            .map(rx.firstValueFrom)
            .orElse(Response.of(410));
    }

    track_kerberos (upn) {
        return rxx.rx(
            this.identities,
            rx.map(ids => ids.filter(i => i.kind == "kerberos" && i.name == upn)),
            rx.map(acc => acc[0]?.uuid));
    }

    find_kerberos (upn) {
        return rx.firstValueFrom(this.track_kerberos(upn));
    }
}
