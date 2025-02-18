/*
 * ACS Auth service
 * HTTP API v2
 * Copyright 2025 University of Sheffield AMRC
 */

import express from "express";
import * as imm from "immutable";
import * as rx from "rxjs";

import { Perm } from "./uuids.js";
import { valid_krb, valid_uuid } from "./validate.js";

function fail (status) {
    throw { status };
}

/* XXX This code is inconsistent about use of native JS vs Rx vs
 * immutable. It could do with tidying up a bit in that respect. */

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

        api.get("/principal", this.id_list.bind(this));
        api.get("/principal/:uuid", this.id_get_all.bind(this));
        api.route("/principal/:uuid/:kind")
            .get(this.id_get.bind(this))
            .put(this.id_put.bind(this))
            .delete(this.id_del.bind(this));

        api.get("/identity", this.id_kinds.bind(this));
        api.get("/identity/:kind", this.id_list_kind.bind(this));
        api.get("/identity/:kind/:name", this.id_find.bind(this));

        api.get("/whoami", this.id_whoami.bind(this));
        api.get("/whoami/uuid", this.id_whoami_uuid.bind(this));
    
        return api;
    }

    async fetch_acl (principal) {
        const acl = await rx.firstValueFrom(
            this.data.acl_for(principal));
        this.log("Fetched ACL for %s: %o", principal, acl);
        return acl;
    }

    async check_acl (req, perm, targ) {
        const tok = await this.data.check_targ(req.auth, perm, true);
        if (!tok?.(targ)) fail(403);
    }

    async _get_acl (req, res, principal) {
        const acl = await this.fetch_acl(principal);
        if (!acl) fail(404);

        const tok = await this.data.check_targ(req.auth, Perm.ReadACL, true);
        if (!tok) fail(403);
        const rv = acl.filter(e => tok(e.permission));
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
        
        const principal = await this.data.find_kerberos(upn);
        /* Don't return 404, we haven't checked ACLs */
        if (!principal)
            return res.status(200).json([]);

        return this._get_acl(req, res, principal);
    }

    async grant_list (req, res) {
        const tok = await this.data.check_targ(req.auth, Perm.WriteACL, true);
        if (!tok) fail(403);

        const uuids = await this.model.grant_list();
        const rv = uuids.filter(tok);
        return res.status(200).json(rv);
    }

    async grant_get (req, res) {
        const { uuid } = req.params;
        if (!valid_uuid(uuid)) fail(410);

        const g = await this.model.grant_get(uuid);
        if (!g) fail(404);

        await this.check_acl(req, Perm.WriteACL, g.permission);

        return res.status(200).json(g);
    }

    async grant_new (req, res) {
        const grant = req.body;

        const permitted = await this.data.check_targ(req.auth, Perm.WriteACL);
        const rv = await this.data.request({ type: "grant", grant, permitted });
        if (rv.status != 201)
            fail(rv.status);

        return res.status(201).json({ uuid: rv.uuid });
    }

    async grant_put (req, res) {
        const { uuid } = req.params;
        if (!valid_uuid(uuid)) fail(410);

        const grant = req.method == "PUT" ? req.body : null;
        const permitted = await this.data.check_targ(req.auth, Perm.WriteACL);

        const rv = await this.data.request({ type: "grant", uuid, grant, permitted });
        return res.status(rv.status).end();
    }

    /* XXX The permissions here only handle Kerberos identities. */

    async id_list (req, res) {
        const tok = await this.data.check_targ(req.auth, Perm.ReadKrb, true);
        if (!tok) fail(403);

        const ids = await this.data.find_identities(i => tok(i.uuid));
        const rv = [...new Set(ids.map(i => i.uuid))];

        return res.status(200).json(rv);
    }

    async _id_get_all (uuid, res) {
        const ids = await this.data.find_identities(i => i.uuid == uuid);
        if (!ids.length) fail(404);

        const rv = Object.fromEntries(
            ids.map(i => [i.kind, i.name])
                .concat([["uuid", uuid]]));
        return res.status(200).json(rv);
    }

    async id_get_all (req, res) {
        const { uuid } = req.params;
        if (!valid_uuid(uuid)) fail(410);

        await this.check_acl(req, Perm.ReadKrb, uuid);

        return this._id_get_all(uuid, res);
    }

    async id_get (req, res) {
        const { uuid, kind } = req.params;
        if (!valid_uuid(uuid)) fail(410);

        await this.check_acl(req, Perm.ReadKrb, uuid);

        const id = await this.data.find_identities(i => i.uuid == uuid && i.kind == kind);
        if (!id.length) fail(404);

        return res.status(200).json(id[0].name);
    }

    async _id_put (name, req, res) {
        const { uuid, kind } = req.params;
        if (!valid_uuid(uuid)) fail(410);

        await this.check_acl(req, Perm.WriteKrb, uuid);

        const rv = await this.data.request({ type: "identity", uuid, kind, name });
        return res.status(rv.status).end();
    }

    id_put (req, res) {
        return this._id_put(req.body, req, res);
    }

    id_del (req, res) {
        return this._id_put(null, req, res);
    }

    async id_kinds (req, res) {
        const ids = await this.data.find_identities();
        const rv = [...new Set(ids.map(i => i.kind))]
        return res.status(200).json(rv);
    }

    async id_list_kind (req, res) {
        const { kind } = req.params;

        const tok = await this.data.check_targ(req.auth, Perm.ReadKrb, true);
        if (!tok) fail(403);
        
        const ids = await this.data.find_identities(i => i.kind == kind);
        if (!ids.length) fail(404);

        const rv = ids
            .filter(i => tok(i.uuid))
            .map(i => i.name);

        return res.status(200).json(rv);
    }

    async id_find (req, res) {
        const { kind, name } = req.params;

        const tok = await this.data.check_targ(req.auth, Perm.ReadKrb, true);
        if (!tok) fail(403);

        const ids = await this.data.find_identities(i => 
            i.kind == kind && i.name == name && tok(i.uuid));
        if (!ids.length) fail(404);

        return res.status(200).json(ids[0].uuid);
    }

    /* There is no auth check here; any authenticated user can look up
     * their own identities. This will only look up based on Kerberos
     * auth identity. */

    async id_whoami (req, res) {
        const uuid = await this.data.whoami(req.auth);
        if (!uuid) fail(404);
        return this._id_get_all(uuid, res);
    }

    async id_whoami_uuid (req, res) {
        const uuid = await this.data.whoami(req.auth);
        if (!uuid) fail(404);
        return res.status(200).json(uuid);
    }
}
