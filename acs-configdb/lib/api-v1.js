/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * Copyright 2021 AMRC
 */

import content_type from "content-type";
import express from "express";

import { UUIDs } from "@amrc-factoryplus/service-client";

import * as etags from "./etags.js";

import {App, Class, Perm} from "./constants.js";

function compat(dest) {
    const pieces = dest.split("/");
    return (req, res, next) => {
        req.url = pieces
            .map(p => p[0] == ":"
                ? req.params[p.slice(1)]
                : p)
            .join("/");
        next();
    }
}

export default class API {
    constructor(opts) {
        this.fplus = opts.fplus;
        this.auth = opts.auth;

        this.log = this.fplus.debug.bound("apiv1");

        this.routes = express.Router();
        this.model = opts.model;

        this.setup_routes();
    }

    setup_mqtt_link(mqtt) {
        this.model.on("change", mqtt.publish_changed.bind(mqtt));
    }

    setup_routes() {
        let api = this.routes;

        /* Validate against the spec */
        //const spec = url.fileURLToPath(new URL("openapi.yaml", import.meta.url));
        //api.use(OpenApiValidator.middleware({
        //    apiSpec: spec,
        //}));

        //api.use(this.authz.bind(this));

        api.use(express.json({ type: "application/merge-patch+json" }));

        api.all("/app/:app/device", compat(`/app/:app/class/${Class.Device}`));
        api.all("/app/:app/schema", compat(`/app/:app/class/${Class.Schema}`));
        api.all("/app/:app/app", compat(`/app/:app/class/${Class.App}`));
        api.all("/app/:app/device/:object", compat("/app/:app/object/:object"));
        api.all("/app/:app/schema/:object", compat("/app/:app/object/:object"));
        api.all("/app/:app/app/:object", compat("/app/:app/object/:object"));
        api.all("/app/:app/config", compat("/app/:app/object/:app"));

        api.get("/app", this.apps_get.bind(this));
        api.post("/app", this.apps_post.bind(this));
        api.get("/app/:app", this.app_get.bind(this));

        api.get("/app/:app/config-schema", this.app_schema_get.bind(this));
        api.put("/app/:app/config-schema", this.app_schema_put.bind(this));

        api.get("/object", this.object_list.bind(this));
        api.post("/object", this.object_create.bind(this));
        api.delete("/object/:object", this.object_delete.bind(this));
        api.get("/class", this.class_list.bind(this));
        api.get("/class/:class", this.class_get.bind(this));

        api.get("/app/:app/object", this.config_list.bind(this));
        api.get("/app/:app/class/:class", this.config_list.bind(this));
        api.get("/app/:app/search", this.config_search.bind(this));
        api.get("/app/:app/class/:class/search", this.config_search.bind(this));

        api.route("/app/:app/object/:object")
            .get(this.config_get.bind(this))
            .put(this.config_put.bind(this))
            .delete(this.config_delete.bind(this))
            .patch(this.config_patch.bind(this));

        api.post("/load", this.dump_load.bind(this));
        api.get("/save", this.dump_save.bind(this));
    }

    async apps_get(req, res) {
        const ok = await this.auth.check_acl(req.auth, Perm.Manage_Obj, Class.App, true);
        if (!ok) return res.status(403).end();

        let list = await this.model.apps_get();
        res.status(200).json(list);
    }

    async apps_post(req, res) {
        const ok = await this.auth.check_acl(req.auth, Perm.Manage_Obj, Class.App, true);
        if (!ok) return res.status(403).end();

        const uuid = req.body.uuid;

        let rv = await this.model.object_create(uuid, Class.App);

        if (rv < 300) {
            /* XXX this overwrites any existing information */
            /* ignore errors */
            await this.model.config_put(
                {app: App.Info, object: uuid},
                {name: req.body.name});
        }

        res.status(rv).end();
    }

    async app_get(req, res) {
        const ok = await this.auth.check_acl(req.auth, Perm.Manage_Obj, Class.App, true);
        if (!ok) return res.status(403).end();

        const uuid = req.params.app;
        const klass = await this.model.object_class(uuid);
        if (klass != Class.App)
            res.status(404).end();

        const info = await this.model.config_get(
            {app: App.Info, object: uuid});
        const name = info?.config?.name ?? "";

        res.status(200).json({uuid, name});
    }

    async app_schema_get(req, res) {
        const app = req.params.app;

        const ok = await this.auth.check_acl(req.auth, Perm.Read_App, app, true);
        if (!ok) return res.status(403).end();

        let rv = await this.model.app_schema(app);
        if (rv == null)
            res.status(404).end();
        else
            res.status(200).type("application/json").send(rv.schema);
    }

    async app_schema_put(req, res) {
        const app = req.params.app;

        const ok = await this.auth.check_acl(req.auth, Perm.Manage_App, app, true);
        if (!ok) return res.status(403).end();

        let rv = await this.model.app_schema_update(app, req.body);

        if (rv === null)
            res.status(400).end();
        else if (rv === true)
            res.status(204).end();
        else if (rv === false)
            res.status(404).end();
        else
            res.status(409).json(rv);
    }

    async object_list(req, res) {
        const ok = await this.auth.check_acl(req.auth, Perm.Manage_Obj, UUIDs.Null);
        if (!ok) return res.status(403).end();

        let list = await this.model.object_list();
        res.status(200).json(list);
    }

    async object_create(req, res) {
        let {uuid, "class": klass} = req.body;

        const ok = await this.auth.check_acl(req.auth, Perm.Manage_Obj, klass, true);
        if (!ok) return res.status(403).end();

        let st;
        if (uuid == null) {
            [st, uuid] = await this.model.object_create_new(klass);
        } else {
            st = await this.model.object_create(uuid, klass);
        }

        res.status(st);
        if (st > 299)
            return res.end();
        res.json({uuid, "class": klass});
    }

    async object_delete(req, res) {
        const {object} = req.params;

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

    async class_get(req, res) {
        const klass = req.params.class;
        const ok = await this.auth.check_acl(req.auth, Perm.Manage_Obj, klass, true);
        if (!ok) return res.status(403).end();

        const list = await this.model.class_get(klass);
        if (list == null)
            return res.status(404).end();
        return res.status(200).json(list);
    }

    async config_list(req, res) {
        let {app, "class": klass} = req.params;

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
        const ok = await this.auth.check_acl(req.auth, Perm.Read_App,
            req.params.app, true);
        if (!ok) return res.status(403).end();

        let entry = await this.model.config_get(req.params);

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
        const ok = await this.auth.check_acl(req.auth, Perm.Write_App,
            req.params.app, true);
        if (!ok) return res.status(403).end();

        /* Do not attempt to set an etag on a PUT response. We can only
         * do this (with a strong etag) if we guarantee that the stored
         * entity is byte-for-byte identical to the submitted entity;
         * the database normalises the JSON so we can't guarantee that.
         * A PUT ETag is only useful for If-Match, and a weak etag can't
         * be used for that. */
        let st = await this.model.config_put(req.params, req.body,
            etags.checker(req));
        res.status(st).send();
    }

    async config_delete(req, res) {
        const ok = await this.auth.check_acl(req.auth, Perm.Write_App,
            req.params.app, true);
        if (!ok) return res.status(403).end();

        let st = await this.model.config_delete(req.params,
            etags.checker(req));
        res.status(st).end();
    }

    async config_patch (req, res) {
        const { type } = content_type.parse(req.header("Content-Type"));
        if (type != "application/merge-patch+json")
            return res.status(415).end();

        const ok = await Promise.all(
            [Perm.Read_App, Perm.Write_App]
            .map(p => this.auth.check_acl(req.auth, p, req.params.app, true)));
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

    async dump_load(req, res) {
        const dump = req.body;
        const booleans = {
            "true": true, "false": false,
            "1": true, "0": false,
            on: true, off: false,
            yes: true, no: false,
        };

        const overwrite = booleans[req.query.overwrite];
        if (overwrite == undefined)
            return res.status(400).end();

        if (!await this.model.dump_validate(dump))
            return res.status(400).end();

        const perms = {
            classes: Perm.Manage_Obj,
            objects: Perm.Manage_Obj,
            configs: Perm.Write_App,
        };
        for (const [key, perm] of Object.entries(perms)) {
            if (key in dump) {
                const ok = await this.auth.check_acl(
                    req.auth, perm, UUIDs.Null, false);
                if (!ok) {
                    this.log("Refusing dump (%s)", key);
                    return res.status(403).end();
                }
            }
        }

        const st = await this.model.dump_load(dump, !!overwrite);
        res.status(st).end();
    }

    async dump_save(req, res) {
        const ok = await this.auth.check_acl(req.auth, Perm.Manage_Obj, UUIDs.Null)
            && await this.auth.check_acl(req.auth, Perm.Read_App, UUIDs.Null);
        if (!ok) return res.status(403).end();

        const dump = await this.model.dump_save();
        res.status(200).json(dump);
    }
}
