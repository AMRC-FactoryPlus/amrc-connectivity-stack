/*
 * Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
 * Authorisation (ACLs)
 * Copyright 2022 AMRC
 */

import express from "express";

import { forward } from "@amrc-factoryplus/service-api";

import {Perm, Special} from "./uuids.js";
import { booleans, valid_krb, valid_uuid } from "./validate.js";

export default class AuthZ {
    constructor(opts) {
        this.model = opts.model;
        this.data = opts.data;

        this.log = opts.debug.bound("authz");

        this.routes = this.setup_routes();
    }

    setup_routes() {
        let api = express.Router();

        const gone = (req, res) => res.status(410).end();
        
        /* These are all removed. */
        api.route("/principal")
            .get(gone)
            .post(gone);
        api.get("/ace", gone);
        api.post("/ace", gone);
        api.get("/effective", gone);
        api.get("/effective/:principal", gone);

        /* This will be used by other services until they are all
         * updated. */
        api.get("/acl", this.get_acl.bind(this));

        /* These are used by the service-client library to find
         * Sparkplug addresses; in particular by the Edge Agent. */
        api.get("/principal/find", this.principal_find.bind(this));
        api.route("/principal/:uuid")
            .get(this.principal_get.bind(this))
            .delete(gone);

        /* These endpoints are for migration only. PUT has been removed
         * so group members can only be deleted. Normally all groups
         * will be cleared the first time service-setup runs; the only
         * reason for this not happening would be if groups were not
         * correctly registered in the ConfigDB. */
        api.get("/group/all", this.group_all.bind(this));
        api.get("/group", this.group_get.bind(this));
        api.get("/group/:group", this.group_get.bind(this));
        api.route("/group/:group/:member")
            .put(gone)
            .delete(this.group_delete.bind(this));

        return api;
    }

    /* This accepts a `permission` QS for compatibility but ignores it.
     * Now we always return all permissions the client can read. */
    async get_acl(req, res) {
        const { principal, permission } = req.query;
        const by_uuid = booleans[req.query["by-uuid"]];

        if (by_uuid == undefined)
            return res.status(400).end();

        const princ_valid = by_uuid
            ? valid_uuid(principal) : valid_krb(principal);
        if (!princ_valid || !valid_uuid(permission))
            return res.status(410).end();

        const url = by_uuid ? `/v2/acl/${principal}`
            : `/v2/acl/kerberos/${encodeURIComponent(principal)}`;
        return forward(url)(req, res);
    }

    async principal_get(req, res) {
        const {uuid} = req.params;
        if (!valid_uuid(uuid))
            return res.status(410).end();

        /* The permissions here are odd for historical reasons. If the
         * principal turns out to be the client's they can look up
         * regardless. */

        /* This API only ever returns Kerberos identities */
        const idr = await this.data.find_identities(
            this.data.root, { uuid, kind: "kerberos" });
        const kerberos = idr.single().map(id => id.name).get();
        this.log("Fetched krb %s", kerberos);

        if (kerberos == req.auth) {
            this.log("Permitting legacy exception for %s", req.auth);
        }
        else {
            const tok = await this.data.check_targ(req.auth, Perm.ReadKrb, true);
            if (!tok?.(uuid))
                return res.status(403).end();
        }

        if (!kerberos) return res.status(404).end();
        return res.status(200).json({ uuid, kerberos });
    }

    /* XXX This also used to allow by-name lookup of the client's own
     * identity, but I don't think that's used anywhere. */
    async principal_find(req, res) {
        const kerberos = req.query?.kerberos;
        const url = kerberos == null ? "/v2/whoami/uuid"
            : `/v2/identity/kerberos/${kerberos}`;
        return forward(url)(req, res);
    }

    /* These all now require wildcard ManageGroup. This is a change from
     * before but this is meant to be an admin-only interface now. */
    async group_all(req, res) {
        const tok = await this.data.check_targ(req.auth, Perm.ManageGroup, false);
        if (!tok?.(Special.Wildcard))
            return res.status(403).end();

        const groups = await this.model.group_all();
        return res.status(200).json(groups);
    }

    async group_get (req, res) {
        const tok = await this.data.check_targ(req.auth, Perm.ManageGroup, false);
        if (!tok?.(Special.Wildcard))
            return res.status(403).end();

        const { group } = req.params;

        const rv = group
            ? await this.model.group_get(group)
            : await this.model.group_list();
        return res.status(200).json(rv);
    }

    async group_delete(req, res) {
        const tok = await this.data.check_targ(req.auth, Perm.ManageGroup, false);
        if (!tok?.(Special.Wildcard))
            return res.status(403).end();

        const {group, member} = req.params;

        const st = await this.model.group_delete(group, member);
        return res.status(st).end();
    }
}
