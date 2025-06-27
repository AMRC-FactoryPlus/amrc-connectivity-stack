/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * Copyright 2021 AMRC
 */

import content_type from "content-type";
import express from "express";

import { UUIDs } from "@amrc-factoryplus/service-client";

import * as etags from "./etags.js";

import {App, Class, Perm} from "./constants.js";

const Valid = {
    uuid:   /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};

export class APIv2 {
    constructor(opts) {
        this.fplus = opts.fplus;
        this.auth = opts.auth;

        this.log = this.fplus.debug.bound("apiv2");

        this.routes = express.Router();
        this.model = opts.model;

        this.setup_routes();
    }

    setup_mqtt_link(mqtt) {
        this.model.on("change", mqtt.publish_changed.bind(mqtt));
    }

    setup_routes() {
        let api = this.routes;

        const compat = dest => {
            const pieces = dest.split("/");
            return (req, res, next) => {
                req.url = pieces
                    .map(p => p[0] == ":"
                        ? req.params[p.slice(1)]
                        : p)
                    .join("/");
                this.log("COMPAT: -> %s", req.url);
                next();
            }
        };

        api.get("/app", compat(`/class/${Class.App}/member`));
        api.get("/class", compat(`/class/${Class.Class}/member`));

        api.get("/object", this.object_list.bind(this));
        api.post("/object", this.object_create.bind(this));
        api.delete("/object/:object", this.object_delete.bind(this));
        api.get("/object/rank", this.object_ranks.bind(this));

        api.get("/class/:class", this.class_info.bind(this));

        const clookup = (path, table) => {
            const lookup = this.class_lookup.bind(this, table);
            api.get(`/class/:class/${path}`, lookup);
            api.get(`/class/:class/${path}/:object`, lookup);
        };
        clookup("direct/member", "membership");
        clookup("direct/subclass", "subclass");
        clookup("member", "all_membership");
        clookup("subclass", "all_subclass");

        api.route("/class/:class/direct/member/:object")
            .put(this.class_rel.bind(this, m => m.class_add_member))
            .delete(this.class_rel.bind(this, m => m.class_remove_member));
        api.route("/class/:class/direct/subclass/:object")
            .put(this.class_rel.bind(this, m => m.class_add_subclass))
            .delete(this.class_rel.bind(this, m => m.class_remove_subclass));

        api.get("/app/:app/object", this.config_list.bind(this));
        api.get("/app/:app/class/:class", this.config_list.bind(this));

        api.route("/app/:app/object/:object")
            .get(this.config_get.bind(this))
            .put(this.config_put.bind(this))
            .delete(this.config_delete.bind(this))
            .patch(this.config_patch.bind(this));

        api.get("/save", this.dump_save.bind(this));
    }

    async app_get(req, res) {
        if (!Valid.uuid.test(req.params.app))
            return res.status(410).end();

        const ok = await this.auth.check_acl(req.auth, Perm.Manage_Obj, Class.App, true);
        if (!ok) return res.status(403).end();

        const uuid = req.params.app;
        /* XXX What verification do we want here? Do we insist that an
         * App-UUID is a member of Application, or do we allow any
         * object? */
        const klass = await this.model.object_class(uuid);
        if (klass != Class.App)
            res.status(404).end();

        const info = await this.model.config_get(
            {app: App.Info, object: uuid});
        const name = info?.config?.name ?? "";

        res.status(200).json({uuid, name});
    }

    async object_list(req, res) {
        const ok = await this.auth.check_acl(req.auth, Perm.Manage_Obj, UUIDs.Null);
        if (!ok) return res.status(403).end();

        let list = await this.model.object_list();
        res.status(200).json(list);
    }

    async object_ranks (req, res) {
        const ok = await this.auth.check_acl(req.auth, Perm.Manage_Obj, UUIDs.Null);
        if (!ok) return res.status(403).end();

        const list = await this.model.object_ranks();
        res.status(200).json(list);
    }

    async object_create(req, res) {
        const spec = req.body;

        const ok = await this.auth.check_acl(req.auth, Perm.Manage_Obj, 
            spec.class ?? UUIDs.Null, true);
        if (!ok) return res.status(403).end();

        if (!this.auth.is_root(req.auth)) {
            spec.owner = await this.fplus.Auth.resolve_identity("kerberos", req.auth);
            if (!spec.owner)
                return res.status(503).end();
        }
        const [st, info] = await this.model.object_create(spec);

        if (st > 299)
            return res.status(st).end();

        res.status(st).json(info);
    }

    async object_delete(req, res) {
        const {object} = req.params;
        if (!Valid.uuid.test(object))
            return res.status(410).end();

        const ok = await this.auth.check_acl(req.auth, Perm.Delete_Obj, object, true);
        if (!ok) return res.status(403).end();

        const [st, rv] = await this.model.object_delete(object);

        res.status(st);
        rv ? res.json(rv) : res.end();
    }

    async class_list(req, res) {
        const ok = await this.auth.check_acl(req.auth, Perm.Manage_Obj, UUIDs.Null);
        if (!ok) return res.status(403).end();
        const list = await this.model.class_list();
        return res.status(200).json(list);
    }

    async class_info (req, res) {
        const klass = req.params.class;
        if (!Valid.uuid.test(klass))
            return res.status(410).end();

        const ok = await this.auth.check_acl(req.auth, Perm.Manage_Obj, klass, true);
        if (!ok) return res.status(403).end();

        const members = await this.model.class_lookup(klass, "membership");
        const subclasses = await this.model.class_lookup(klass, "subclasses");

        if (!members && !subclasses)
            return res.status(404);

        return res.status(200).json({ members, subclasses });
    }

    async class_lookup (rel, req, res) {
        const { class: klass, object } = req.params;
        if (!Valid.uuid.test(klass) || (object && !Valid.uuid.test(object)))
            return res.status(410).end();

        const ok = await this.auth.check_acl(req.auth, Perm.Manage_Obj, klass, true);
        if (!ok) return res.status(403).end();

        if (object) {
            const present = await this.model.class_has(klass, rel, object);
            return res.status(present ? 204 : 404).end();
        }

        const list = await this.model.class_lookup(klass, rel);
        if (!list) return res.status(404).end();
        return res.status(200).json(list);
    }

    async class_rel (action, req, res) {
        const { class: klass, object } = req.params;
        if (!Valid.uuid.test(klass) || !Valid.uuid.test(object))
            return res.status(410).end();

        const ok = await this.auth.check_acl(req.auth, Perm.Manage_Obj, klass, true);
        if (!ok) return res.status(403).end();

        const st = await action(this.model).call(this.model, klass, object);
        return res.status(st).end();
    }

    async config_list(req, res) {
        let {app, "class": klass} = req.params;
        if (!Valid.uuid.test(app) || (klass && !Valid.uuid.test(klass)))
            return res.status(410).end();

        const ok = await this.auth.check_acl(req.auth, Perm.Read_App, app, true);
        if (!ok) return res.status(403).end();

        let list = klass
            ? await this.model.config_class_list(app, klass)
            : await this.model.config_list(app);

        if (list == null)
            res.status(404).send();
        else
            res.status(200).json(list);
    }

    async config_get(req, res) {
        const { app, object } = req.params;
        if (!Valid.uuid.test(app) || !Valid.uuid.test(object))
            return res.status(410).end();

        const ok = await this.auth.check_acl(req.auth, Perm.Read_App,
            req.params.app, true);
        if (!ok) return res.status(403).end();

        let entry = await this.model.config_get({ app, object });

        const etst = etags.checker(req)(entry?.etag);
        if (etst == 412) {
            if (entry) res.header("ETag", `"${entry.etag}"`)
            return res.status(304).end();
        }
        if (etst) return res.status(etst).end();
        if (entry == null) return res.status(404).end();

        res.status(200);
        if (entry.etag) res.header("ETag", `"${entry.etag}"`);
        res.json(entry.config);
    }

    async config_put(req, res) {
        const { app, object } = req.params;
        if (!Valid.uuid.test(app) || !Valid.uuid.test(object))
            return res.status(410).end();
        const ok = await this.auth.check_acl(req.auth, Perm.Write_App,
            req.params.app, true);
        if (!ok) return res.status(403).end();

        /* Do not attempt to set an etag on a PUT response. We can only
         * do this (with a strong etag) if we guarantee that the stored
         * entity is byte-for-byte identical to the submitted entity;
         * the database normalises the JSON so we can't guarantee that.
         * A PUT ETag is only useful for If-Match, and a weak etag can't
         * be used for that. */
        let st = await this.model.config_put({ app, object }, req.body,
            etags.checker(req));
        res.status(st).send();
    }

    async config_delete(req, res) {
        const { app, object } = req.params;
        if (!Valid.uuid.test(app) || !Valid.uuid.test(object))
            return res.status(410).end();
        const ok = await this.auth.check_acl(req.auth, Perm.Write_App,
            req.params.app, true);
        if (!ok) return res.status(403).end();

        let st = await this.model.config_delete({ app, object },
            etags.checker(req));
        res.status(st).end();
    }

    async config_patch (req, res) {
        const { app, object } = req.params;
        if (!Valid.uuid.test(app) || !Valid.uuid.test(object))
            return res.status(410).end();

        const { type } = content_type.parse(req.header("Content-Type"));
        if (type != "application/merge-patch+json")
            return res.status(415).end();

        const ok = await Promise.all(
            [Perm.Read_App, Perm.Write_App]
            .map(p => this.auth.check_acl(req.auth, p, app, true)));
        if (ok.includes(false))
            return res.status(403).end();

        const st = await this.model.config_merge_patch(req.params, req.body,
            etags.checker(req));
        res.status(st == 201 ? 204 : st).send();
    }

    config_search_parse(query) {
        const where = new Map();
        const select = new Map();

        const path = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;
        const result = /^@[A-Za-z_]\w*$/;
        /* This is deliberately limited to a subset of JSON scalar
         * syntax. There should be no need for more than this. */
        /* Pretty please can I haz /x? */
        const scalar = /^(?:undefined|null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?|"(?:[^"\\]|\\["\\])*")$/;

        for (const [name, value] of Object.entries(query)) {
            if (result.test(name) && path.test(value)) {
                const prop = name.slice(1);
                if (prop == "uuid")
                    return;
                select.set(prop, value);
            } else if (path.test(name) && scalar.test(value)) {
                where.set(name, value);
            } else {
                return;
            }
        }

        return {where, select};
    }

    async config_search(req, res) {
        const {app, "class": klass} = req.params;
        if (!Valid.uuid.test(app) || (klass && !Valid.uuid.test(klass)))
            return res.status(410).end();
        const ok = await this.auth.check_acl(req.auth, Perm.Read_App, app, true);
        if (!ok) return res.status(403).end();

        const query = this.config_search_parse(req.query);
        if (query == undefined)
            return res.status(400).end();

        const results = await this.model.config_search(app, klass, query);
        const json = query.select.size == 0
            ? results.map(r => r.uuid)
            : Object.fromEntries(results.map(r => [r.uuid, r.results]));

        return res.status(200).json(json);
    }

    async dump_save(req, res) {
        const ok = await this.auth.check_acl(req.auth, Perm.Manage_Obj, UUIDs.Null)
            && await this.auth.check_acl(req.auth, Perm.Read_App, UUIDs.Null);
        if (!ok) return res.status(403).end();

        const dump = await this.model.dump_save();
        res.status(200).json(dump);
    }
}
