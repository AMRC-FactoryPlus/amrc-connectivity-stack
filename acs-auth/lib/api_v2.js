/*
 * ACS Auth service
 * HTTP API v2
 * Copyright 2025 University of Sheffield AMRC
 */

import express from "express";
import * as rx from "rxjs";

import { APIError } from "@amrc-factoryplus/service-api";

import { Perm } from "./uuids.js";
import { valid_grant, valid_krb, valid_uuid } from "./validate.js";

function fail (status, message) {
    throw new APIError(status);
}

/* XXX This code is inconsistent about use of native JS vs Rx vs
 * immutable. It could do with tidying up a bit in that respect. */

export class APIv2 {
    constructor(opts) {
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
        api.post("/grant/find", this.grant_find.bind(this));

        api.get("/principal", this.id_list.bind(this));
        api.get("/principal/:uuid", this.id_get_all.bind(this));
        /* `/principal/:uuid/groups` must be registered BEFORE the
         * `/principal/:uuid/:kind` route below, otherwise Express's
         * matcher treats "groups" as an identity kind and routes to
         * the wrong handler. */
        api.get("/principal/:uuid/groups", this.id_groups.bind(this));
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

        const grants = await rx.firstValueFrom(this.data.grants);
        const rv = grants.map(g => g.uuid).filter(tok);
        return res.status(200).json(rv);
    }

    async grant_get (req, res) {
        const { uuid } = req.params;
        if (!valid_uuid(uuid)) fail(410);

        const grants = await rx.firstValueFrom(this.data.grants);
        const g = grants.find(g => g.uuid == uuid);
        if (!g) fail(404);

        await this.check_acl(req, Perm.WriteACL, g.permission);

        return res.status(200).json(g);
    }

    async grant_new (req, res) {
        const grant = req.body;
        if (!valid_grant(grant))
            fail(422);

        const permitted = await this.data.check_targ(req.auth, Perm.WriteACL, true);
        const rv = await this.data.request({ type: "grant", grant, permitted });
        if (rv.status > 299)
            fail(rv.status);

        return res.status(rv.status).json({ uuid: rv.uuid });
    }

    async grant_put (req, res) {
        const { uuid } = req.params;
        if (!valid_uuid(uuid)) fail(410);

        const grant = req.method == "PUT" ? req.body : null;
        if (grant && !valid_grant(grant)) fail(422);
        /* XXX There is a race condition here but I can't see how to
         * avoid it. Our permitted list is built here, before the txn,
         * so in principle is out of date by the time we use it. But we
         * need to sample the ConfigDB information somewhere, and we
         * don't have cross-service transactions. */
        const permitted = await this.data.check_targ(req.auth, Perm.WriteACL, true);

        const rv = await this.data.request({ type: "grant", uuid, grant, permitted });
        return res.status(rv.status).end();
    }

    async grant_find (req, res) {
        const { principal, permission, target, plural } = req.body;

        for (const u of [principal, permission, target]) {
            if (!(u == null || valid_uuid(u)))
                fail(422);
        }
        if (!(plural == null || typeof(plural) == "boolean"))
            fail(422);

        const tok = await this.data.check_targ(req.auth, Perm.WriteACL, true);
        if (!tok) fail(403);

        const grants = await rx.firstValueFrom(this.data.grants);
        const maybe = (got, want) => want == null || got == want;
        const rv = grants.filter(g =>
                maybe(g.principal, principal) &&
                maybe(g.permission, permission) &&
                maybe(g.target, target) &&
                maybe(g.plural, plural))
            .map(g => g.uuid)
            .filter(tok);
        return res.status(200).json(rv);
    }

    /* XXX The permissions here only handle Kerberos identities. */

    async id_list (req, res) {
        const idr = await this.data.find_identities(req.auth);

        idr.uniq(i => i.uuid).toExpress(res);
    }

    async _id_get_all (upn, uuid, res) {
        const idr = await this.data.find_identities(upn, { uuid });

        idr.map(ids => 
            Object.fromEntries(
                ids.map(i => [i.kind, i.name])
                    .concat([["uuid", uuid]])))
            .toExpress(res);
    }

    async id_get_all (req, res) {
        const { uuid } = req.params;
        return this._id_get_all(req.auth, uuid, res);
    }

    async id_get (req, res) {
        const { uuid, kind } = req.params;

        const idr = await this.data.find_identities(req.auth, { uuid, kind });
        idr.single().map(id => id.name).toExpress(res);
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

    /** GET /principal/:uuid/groups
     *
     * Returns the UUIDs of all principal-groups containing the given
     * principal (recursively). Used by external services that need to
     * compute group-aware authorisation (the Keycloak SPI's fp_groups
     * claim is the first consumer; future northbound shims will follow).
     *
     * Status codes:
     *   200 - JSON array of group UUIDs
     *   403 - caller lacks ReadKrb wildcard
     *   410 - target principal doesn't exist
     */
    async id_groups (req, res) {
        const { uuid } = req.params;
        if (!valid_uuid(uuid)) fail(410);

        const r = await this.data.find_groups(req.auth, uuid);
        r.toExpress(res);
    }

    async id_kinds (req, res) {
        /* XXX This should not be hardcoded. But it cannot change at
         * runtime. */
        return res.status(200).json(["kerberos"]);
    }

    async id_list_kind (req, res) {
        const { kind } = req.params;

        const idr = await this.data.find_identities(req.auth, { kind });
        idr.uniq(i => i.name).toExpress(res);
    }

    async id_find (req, res) {
        const { kind, name } = req.params;

        const idr = await this.data.find_identities(req.auth, { kind, name });
        idr.single().map(id => id.uuid).toExpress(res);
    }

    /* There is no auth check here; any authenticated user can look up
     * their own identities. Resolves req.auth to a principal UUID
     * regardless of how the caller authenticated: a JWT puts the UUID
     * straight on req.auth (the JWT branch in service-api uses
     * fp_principal_uuid as the principal); Basic/Negotiate put a
     * Kerberos UPN there which needs a kerberos -> uuid lookup. */

    async _whoami_uuid (req) {
        return valid_uuid(req.auth)
            ? req.auth
            : await this.data.find_kerberos(req.auth);
    }

    async id_whoami (req, res) {
        const uuid = await this._whoami_uuid(req);
        if (!uuid) fail(404);
        return this._id_get_all(this.data.root, uuid, res);
    }

    async id_whoami_uuid (req, res) {
        const uuid = await this._whoami_uuid(req);
        if (!uuid) fail(404);
        return res.status(200).json(uuid);
    }
}
