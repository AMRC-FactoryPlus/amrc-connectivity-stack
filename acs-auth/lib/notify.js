/* ACS Auth service
 * Change-notify interface
 * Copyright 2025 University of Sheffield AMRC
 */

import * as rx from "rxjs";

import * as rxx     from "@amrc-factoryplus/rx-util";
import { Notify }   from "@amrc-factoryplus/service-api";

import { Perm }                     from "./uuids.js";
import { valid_krb, valid_uuid }    from "./validate.js";

export class AuthNotify {
    constructor (opts) {
        this.data   = opts.data;
        this.log    = opts.debug.bound("notify");

        this.notify = this.build_notify(opts.api);
    }

    run () {
        this.log("Running notify server");
        this.notify.run();
    }

    build_notify (api) {
        const notify = new Notify({
            api,
            log:    this.log,
        });

        notify.watch("v2/principal/", this.principal_list.bind(this));
//        notify.search("v2/principal/", this.principal_search.bind(this));
//
//        api.get("/principal", this.id_list.bind(this));
//        api.get("/principal/:uuid", this.id_get_all.bind(this));
//        api.route("/principal/:uuid/:kind")
//            .get(this.id_get.bind(this))
//            .put(this.id_put.bind(this))
//            .delete(this.id_del.bind(this));

        notify.watch("v2/identity/:kind/", this.id_list_kind.bind(this));

//        api.get("/identity", this.id_kinds.bind(this));
//        api.get("/identity/:kind", this.id_list_kind.bind(this));
//        api.get("/identity/:kind/:name", this.id_find.bind(this));

        notify.watch("v2/acl/:principal", this.get_acl.bind(this));
        notify.watch("v2/acl/kerberos/:upn", this.get_krb_acl.bind(this));

        return notify;
    }

    principal_list (sess) {
        const idt = this.data.track_identities(sess.principal);
        if (!idt.isPresent) return;

        return rxx.rx(
            idt.get(),
            rx.map(idr => idr.uniq(i => i.uuid)),
            rx.map((res, ix) => res.toUpdate(ix)));
    }

    rxlog (msg) {
        return rx.tap(v => this.log(msg, v));
    }

    id_list_kind (sess, kind) {
        const idt = this.data.track_identities(sess.principal, { kind });
        if (!idt.isPresent) return;

        return rxx.rx(
            idt.get(),
            rx.map(idr => idr.uniq(i => i.name)),
            rx.map((res, ix) => res.toUpdate(ix)),
            this.rxlog("Update: %o"),
        );
    }

    /* A principal can always read their own ACL in full, without
     * needing Perm.ReadACL, the same way the HTTP API's id_whoami
     * lets them look up their own identities. `sess.principal` and
     * `principal$` may each be a UUID or a Kerberos UPN, so resolve
     * both to UUIDs before comparing. */
    _get_acl (sess, principal$, src) {
        const caller$ = this.data.resolve_principal(sess.principal);
        return rxx.rx(
            rx.combineLatest([src, principal$, caller$,
                this.data.permitted(sess.principal, Perm.ReadACL, true)]),
            rx.map(([acl, principal, caller, tok]) =>
                !acl                        ? rxx.Response.of(404)
                : caller != null && caller === principal
                                             ? rxx.Response.ok(acl)
                : !tok                      ? rxx.Response.of(403)
                : rxx.Response.ok(acl.filter(e => tok(e.permission)))),
            rx.map((r, i) => r.toUpdate(i)),
            this.rxlog("ACL update: %o"));
    }

    get_acl (sess, principal) {
        if (!valid_uuid(principal)) return;
        return this._get_acl(sess, rx.of(principal), this.data.acl_for(principal));
    }

    get_krb_acl (sess, upn) {
        const { data } = this;

        if (!valid_krb(upn)) return;

        const principal$ = data.track_kerberos(upn);
        const src = rxx.rx(
            principal$,
            rx.switchMap(p => p ? data.acl_for(p) : rx.of(null)));

        return this._get_acl(sess, principal$, src);
    }
}
