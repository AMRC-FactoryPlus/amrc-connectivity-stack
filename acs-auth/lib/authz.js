/*
 * Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
 * Authorisation (ACLs)
 * Copyright 2022 AMRC
 */

import express from "express";

import {Debug, UUIDs} from "@amrc-factoryplus/utilities";

import Model from "./model.js";
import {Perm} from "./uuids.js";

const UUID_rx = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KRB_rx = /^[a-zA-Z0-9_./-]+@[A-Z0-9-.]+$/;

const debug = new Debug();
const booleans = {
    undefined: false,
    "true": true, "false": false,
    "1": true, "0": false,
    on: true, off: false,
    yes: true, no: false,
};

function valid_uuid(uuid) {
    if (UUID_rx.test(uuid))
        return true;
    debug.log("debug", `Ignoring invalid UUID [${uuid}]`);
    return false;
}

function valid_krb(krb) {
    if (KRB_rx.test(krb))
        return true;
    debug.log("debug", `Ignoring invalid principal [${krb}]`);
    return false;
}

export default class AuthZ {
    constructor(opts) {
        this.model = new Model(opts);
        this.routes = express.Router();
    }

    async init() {
        await this.model.init();
        this.setup_routes();
        return this;
    }

    setup_routes() {
        let api = this.routes;

        /* Validate against the spec */
        //const spec = url.fileURLToPath(new URL("openapi.yaml", import.meta.url));
        //api.use(OpenApiValidator.middleware({
        //    apiSpec: spec,
        //}));

        //api.use(this.authz.bind(this));

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

        api.get("/group", this.group_list.bind(this));
        api.get("/group/:group", this.group_get.bind(this));
        api.put("/group/:group/:member", this.group_add.bind(this));
        api.delete("/group/:group/:member", this.group_delete.bind(this));

        api.get("/effective", this.effective_list.bind(this));
        api.get("/effective/:principal", this.effective_get.bind(this));

        api.post("/load", this.dump_load.bind(this));
        api.get("/save", this.dump_save.bind(this));
    }

    async get_acl(req, res) {
        const {principal, permission} = req.query;
        const by_uuid = booleans[req.query["by-uuid"]];

        if (by_uuid == undefined)
            return res.status(400).end();

        const princ_valid = by_uuid
            ? valid_uuid(principal) : valid_krb(principal);
        if (!princ_valid || !valid_uuid(permission))
            return res.status(400).end();

        const ok = await this.model.check_acl(
            req.auth, Perm.Read_ACL, permission, true)
        if (!ok)
            return res.status(403).end();

        const acl = await this.model.get_acl(principal, permission, by_uuid);
        return res.status(200).json(acl);
    }

    async ace_get(req, res) {
        const ok = await this.model.check_acl(
            req.auth, Perm.Manage_ACL, UUIDs.Null, false);
        if (!ok) return res.status(403).end();

        const aces = await this.model.ace_get_all();
        return res.status(200).json(aces);
    }

    async ace_post(req, res) {
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
        const ok = await this.model.check_acl(
            req.auth, Perm.Read_Krb, UUIDs.Null, false);
        if (!ok) return res.status(403).end();

        const princs = await this.model.principal_get_all();
        return res.status(200).json(princs);
    }

    async principal_add(req, res) {
        const princ = req.body;

        const ok = await this.model.check_acl(
            req.auth, Perm.Manage_Krb, UUIDs.Null, false);
        if (!ok) return res.status(403).end();

        const st = await this.model.principal_add(princ);
        return res.status(st).end();
    }

    async principal_get(req, res) {
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
        const kerberos = req.query?.kerberos ?? req.auth;
        if (!valid_krb(kerberos))
            return res.status(400).end();

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

    async group_list(req, res) {
        const ok = await this.model.check_acl(
            req.auth, Perm.Manage_Group, UUIDs.Null, false);
        if (!ok) return res.status(403).end();

        const groups = await this.model.group_list();
        return res.status(200).json(groups);
    }

    async group_get(req, res) {
        const grp = req.params.group;

        const ok = await this.model.check_acl(
            req.auth, Perm.Manage_Group, grp, true);
        if (!ok) return res.status(403).end();

        const members = await this.model.group_get(grp);
        return res.status(200).json(members);
    }

    async group_add(req, res) {
        const {group, member} = req.params;

        const ok = await this.model.check_acl(
            req.auth, Perm.Manage_Group, group, true);
        if (!ok) return res.status(403).end();

        const st = await this.model.group_add(group, member);
        return res.status(st).end();
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
        const ok = await this.model.check_acl(
            req.auth, Perm.Read_Eff, UUIDs.Null, false);
        if (!ok) return res.status(403).end();

        const princs = await this.model.principal_list();
        return res.status(200).json(princs);
    }

    async effective_get(req, res) {
        const ok = await this.model.check_acl(
            req.auth, Perm.Read_Eff, UUIDs.Null, false);
        if (!ok) return res.status(403).end();

        const {principal} = req.params;
        const eff = await this.model.effective_get(principal);
        return res.status(200).json(eff);
    }

    async dump_load(req, res) {
        const dump = req.body;

        if (!this.model.dump_validate(dump)) {
            debug.log("dump", "Dump failed initial validation");
            return res.status(400).end();
        }

        const perms = {
            aces: Perm.Manage_ACL,
            groups: Perm.Manage_Group,
            principals: Perm.Manage_Krb,
        };
        for (const [key, perm] of Object.entries(perms)) {
            if (key in dump) {
                const ok = await this.model.check_acl(
                    req.auth, perm, UUIDs.Null, false);
                if (!ok) {
                    debug.log("dump", "Refusing dump: %s needs permission to set %s",
                        req.auth, key);
                    return res.status(403).end();
                }
            }
        }

        const st = await this.model.dump_load(dump);
        return res.status(st).end();
    }

    async dump_save(req, res) {
        const ckperm = async p =>
            await this.model.check_acl(req.auth, p, UUIDs.Null, false);
        const ok = await ckperm(Perm.Manage_ACL)
            && await ckperm(Perm.Manage_Group)
            && await ckperm(Perm.Manage_Krb);
        if (!ok)
            return res.status(403).end();

        const rv = await this.model.dump_save();
        return res.status(200).json(rv);
    }
}
