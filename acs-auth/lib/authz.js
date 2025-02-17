/*
 * Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
 * Authorisation (ACLs)
 * Copyright 2022 AMRC
 */

import express from "express";

import { UUIDs } from "@amrc-factoryplus/service-client";
import { forward } from "@amrc-factoryplus/service-api";

import {Perm} from "./uuids.js";
import { booleans, valid_krb, valid_uuid } from "./validate.js";

export default class AuthZ {
    constructor(opts) {
        this.debug  = opts.debug;
        this.model = opts.model;

        this.routes = this.setup_routes();
    }

    setup_routes() {
        let api = express.Router();

        /* Validate against the spec */
        //const spec = url.fileURLToPath(new URL("openapi.yaml", import.meta.url));
        //api.use(OpenApiValidator.middleware({
        //    apiSpec: spec,
        //}));

        //api.use(this.authz.bind(this));
        
        /* v1 API:
         *
         * GET acl/:uuid
         * GET acl/identity/:type/:name
         *
         * GET ace # Lists all ACEs we can read?
         * PUT ace/:principal/:permission/:target # Boolean body?
         * DELETE ace/:principal/:permission/:target
         *
         * OR: ACEs get their own UUIDs. (This moves towards treating a
         * Permission as a set of grants.) Then:
         *
         * GET ace
         * POST ace
         * GET ace/:ace
         * PUT ace/:ace
         * DELETE ace/:ace
         * 
         */

        api.get("/acl", this.get_acl.bind(this));

        api.get("/ace", this.ace_get.bind(this));
        api.post("/ace", this.ace_post.bind(this));

        api.route("/principal")
            .get(this.principal_list.bind(this))
            .post(this.principal_add.bind(this));
        api.get("/principal/find", this.principal_find.bind(this));
        api.route("/principal/:uuid")
            .get(this.principal_get.bind(this))
            //.put(this.principal_update.bind(this))
            .delete(this.principal_delete.bind(this));

        /* These endpoints are for migration only. PUT has been removed
         * so group members can only be deleted. Normally all groups
         * will be cleared the first time service-setup runs; the only
         * reason for this not happening would be if groups were not
         * correctly registered in the ConfigDB. */
        api.get("/group/all", this.group_all.bind(this));
        api.get("/group", this.group_get.bind(this));
        api.get("/group/:group", this.group_get.bind(this));
        api.delete("/group/:group/:member", this.group_delete.bind(this));

        api.get("/effective", this.effective_list.bind(this));
        api.get("/effective/:principal", this.effective_get.bind(this));

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

    async ace_get(req, res) {
        const ok = await this.model.check_acl(
            req.auth, Perm.Manage_ACL, UUIDs.Null, false);
        if (!ok) return res.status(403).end();

        const aces = await this.model.grant_get_all();
        return res.status(200).json(aces);
    }

    async ace_post(req, res) {
        return res.status(500).end();
        const ace = req.body;

        const ok = await this.model.check_acl(
            req.auth, Perm.Manage_ACL, ace.permission, true);
        if (!ok) return res.status(403).end();

        const st = await this.model.action_invoke(
            {add: "ace_add", delete: "ace_delete",},
            ace.action, ace);

        return res.status(st).end();
    }

    async principal_list(req, res) {
        return res.status(500).end();
        const ok = await this.model.check_acl(
            req.auth, Perm.Read_Krb, UUIDs.Null, false);
        if (!ok) return res.status(403).end();

        const princs = await this.model.principal_get_all();
        return res.status(200).json(princs);
    }

    async principal_add(req, res) {
        return res.status(500).end();
        const princ = req.body;

        const ok = await this.model.check_acl(
            req.auth, Perm.Manage_Krb, UUIDs.Null, false);
        if (!ok) return res.status(403).end();

        const st = await this.model.principal_add(princ);
        return res.status(st).end();
    }

    async principal_get(req, res) {
        return res.status(500).end();
        const {uuid} = req.params;
        if (!valid_uuid(uuid))
            return res.status(400).end();

        const ids = await this.model.principal_get(uuid);

        /* We can return 403 here as long as we don't return 404 until
         * we've checked the permissions. */
        const ok = req.auth == ids?.kerberos
            || await this.model.check_acl(req.auth, Perm.Read_Krb, uuid, true);
        if (!ok) return res.status(403).end();

        if (ids == null)
            return res.status(404).end();
        return res.status(200).json(ids);
    }

    async principal_delete(req, res) {
        return res.status(500).end();
        const {uuid} = req.params;
        if (!valid_uuid(uuid))
            return res.status(400).end();

        const ok = await this.model.check_acl(
            req.auth, Perm.Manage_Krb, uuid, true);
        if (!ok) return res.status(403).end();

        const st = await this.model.principal_delete(uuid);
        return res.status(st).end();
    }

    /* This endpoint may change in future to allow searching for
     * principals by other criteria, e.g. Node address. */
    async principal_find(req, res) {
        const kerberos = req.query?.kerberos;
        const url = kerberos == null ? "/v2/whoami/uuid"
            : `/v2/identity/kerberos/${kerberos}`;
        return forward(url)(req, res);
    }

    async group_all(req, res) {
        const ok = await this.model.check_acl(
            req.auth, Perm.Manage_Group, UUIDs.Null, false);
        if (!ok) return res.status(403).end();

        const groups = await this.model.group_all();
        return res.status(200).json(groups);
    }

    async group_get (req, res) {
        const { group } = req.params;

        const ok = await this.model.check_acl(
            req.auth, Perm.Manage_Group, UUIDs.Null, false);
        if (!ok) return res.status(403).end();

        const rv = group
            ? await this.model.group_get(group)
            : await this.model.group_list();
        return res.status(200).json(rv);
    }

    async group_delete(req, res) {
        const {group, member} = req.params;

        const ok = await this.model.check_acl(
            req.auth, Perm.Manage_Group, group, true);
        if (!ok) return res.status(403).end();

        const st = await this.model.group_delete(group, member);
        return res.status(st).end();
    }

    async effective_list(req, res) {
        return res.status(500).end();
        const ok = await this.model.check_acl(
            req.auth, Perm.Read_Eff, UUIDs.Null, false);
        if (!ok) return res.status(403).end();

        const princs = await this.model.principal_list();
        return res.status(200).json(princs);
    }

    async effective_get(req, res) {
        return res.status(500).end();
        const ok = await this.model.check_acl(
            req.auth, Perm.Read_Eff, UUIDs.Null, false);
        if (!ok) return res.status(403).end();

        const {principal} = req.params;
        const eff = await this.model.effective_get(principal);
        return res.status(200).json(eff);
    }
}
