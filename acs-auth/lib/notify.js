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
        //notify.watch("v2/acl/kerberos/:upn", this.get_krb_acl.bind(this));

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

    get_acl (sess, principal) {
        const { data } = this;

        if (!valid_uuid(principal)) return;

        return rxx.rx(
            rx.combineLatest([
                data.acl_for(principal),
                data.permitted(sess.principal, Perm.ReadACL, true),
            ]),
            rx.map(([acl, tok]) => tok
                ? rxx.Response.ok(acl.filter(e => tok(e.permission)))
                : rxx.Response.of(403)),
            rx.map((r, i) => r.toUpdate(i)),
            this.rxlog("ACL update: %o"));
    }

//    async get_krb_acl (req, res) {
//        const { upn } = req.params;
//        if (!valid_krb(upn)) fail(410);
//        
//        const principal = await this.data.find_kerberos(upn);
//        /* Don't return 404, we haven't checked ACLs */
//        if (!principal)
//            return res.status(200).json([]);
//
//        return this._get_acl(req, res, principal);
//    }
}
