/*
 * ACS Auth service
 * HTTP API v2
 * Copyright 2025 University of Sheffield AMRC
 */

import express from "express";
import * as imm from "immutable";
import * as rx from "rxjs";

import { UUIDs } from "@amrc-factoryplus/service-client";

import {Perm} from "./uuids.js";
import { valid_krb, valid_uuid } from "./validate.js";

const Wildcard = UUIDs.Special.Null;

function fail (status) {
    throw { status };
}

export class APIv2 {
    constructor(opts) {
        this.model = opts.model;
        this.data = opts.data;

        this.log = opts.debug.bound("apiv2");

        this.routes = this.setup_routes();
    }

    setup_routes() {
        let api = express.Router();

        api.get("/acl/:principal", this.get_acl.bind(this));
        api.get("/acl/kerberos/:upn", this.get_krb_acl.bind(this));

        api.route("/grant")
            .get(this.grant_list.bind(this))
            .post(this.grant_new.bind(this));
        api.route("/grant/:uuid")
            .get(this.grant_get.bind(this))
            .put(this.grant_put.bind(this))
            .delete(this.grant_put.bind(this));

        api.get("/principal/find", this.principal_find.bind(this));
        api.get("/principal/find/kerberos/:upn", this.principal_find.bind(this));

        return api;
    }

    async fetch_acl (principal) {
        const acl = rx.firstValueFrom(
            this.data.acl_for(principal));
        this.log("Fetched ACL for %s: %o", principal, acl);
        return acl;
    }

    async permitted (req, perm) {
        const permitted = await this.model.principal_find_by_krb(req.auth)
            .then(p => p ? this.fetch_acl(p) : [])
            .then(acl => imm.Seq(acl)
                .filter(e => e.permission == perm)
                .map(e => e.target)
                .toSet());
        this.log("Permitted %s for %s: %o", perm, req.auth, permitted.toJS());
        return permitted;
    }

    async check_acl (req, perm, targ, wild) {
        const targs = await this.permitted(req, perm);
        if (targs.has(targ)) return;
        if (wild && targs.has(Wildcard)) return;
        fail(403);
    }

    async _get_acl (req, res, principal) {
        const acl = await this.fetch_acl(principal);
        if (!acl) fail(404);

        const permitted = await this.permitted(req, Perm.Read_ACL);
        const rv = permitted.has(Wildcard) ? acl
            : acl.filter(e => permitted.has(e.permission));
        this.log("Returning ACL %o", rv);

        return res.status(200).json(rv);
    }

    get_acl (req, res) {
        const { principal } = req.params;
        if (!valid_uuid(principal)) fail(410);

        return this._get_acl(req, res, principal);
    }

    async get_krb_acl (req, res) {
        const { upn } = req.params;
        if (!valid_krb(upn)) fail(410);
        
        const principal = await this.model.principal_find_by_krb(upn);
        /* Don't return 404, we haven't checked ACLs */
        if (!principal)
            return res.status(200).json([]);

        return this._get_acl(req, res, principal);
    }

    async grant_list (req, res) {
        /* XXX I'm not sure this is right, but we generally allow
         * listing UUIDs of objects which can't be read. */
        const targs = await this.permitted(req, Perm.Manage_ACL);
        if (!targs.size) fail(403);

        const uuids = await this.model.grant_list();
        return res.status(200).json(uuids);
    }

    async grant_get (req, res) {
        const { uuid } = req.params;
        if (!valid_uuid(uuid)) fail(410);

        const g = await this.model.grant_get(uuid);
        if (!g) fail(404);

        await this.check_acl(req, Perm.Manage_ACL, g.permission, true);

        return res.status(200).json(g);
    }

    async grant_new (req, res) {
        const grant = req.body;

        const permitted = await this.permitted(req, Perm.Manage_ACL);
        const rv = await this.data.request({ kind: "grant", grant, permitted });
        if (rv.status != 201)
            fail(rv.status);

        return res.status(201).json({ uuid: rv.uuid });
    }

    async grant_put (req, res) {
        const { uuid } = req.params;
        if (!valid_uuid(uuid)) fail(410);

        const grant = req.method == "PUT" ? req.body : null;
        const permitted = await this.permitted(req, Perm.Manage_ACL);

        const rv = await this.data.request({ kind: "grant", uuid, grant, permitted });
        return res.status(rv.status).end();
    }

    /* This endpoint may change in future to allow searching for
     * principals by other criteria, e.g. Node address. */
    async principal_find (req, res) {
        const kerberos = req.params?.upn ?? req.auth;
        if (!valid_krb(kerberos))
            return res.status(410).end();

        const uuid = await this.model.principal_find_by_krb(kerberos);
        if (uuid == null)
            return res.status(404).end();

        /* We have to check permissions against the returned UUID. This
         * means that we must return 404 instead of 403 if the check
         * fails. Principals are always allowed to look up their own
         * information. */
        const ok = req.auth == kerberos
            || await this.model.check_acl(req.auth, Perm.Read_Krb, uuid, true)
        if (!ok) return res.status(404).end();

        return res.status(200).json(uuid);
    }
}
