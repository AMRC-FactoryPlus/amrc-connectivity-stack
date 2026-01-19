/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * Copyright 2021 AMRC
 */

import express from "express";

import { UUIDs } from "@amrc-factoryplus/service-client";

import {App, Class, Perm} from "./constants.js";

export class APIv1 {
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

        /* XXX The v1 API supported ?exclusive=true on a PUT config
         * request to forbid overwrites. This could be mapped into an
         * If-None-Match, but I don't think it's used anywhere. */
        
        const forwards = [
            ["/app",                `/v2/class/${Class.App}/member`],
            ["/app/:app/config",            "/v2/app/:app/object/:app"],
            ["/app/:app/config-schema",     
                                `/v2/app/${App.ConfigSchema}/object/:app`],

            ["/app/:app/device",    `/v2/app/:app/class/${Class.Device}`],
            ["/app/:app/schema",    `/v2/app/:app/class/${Class.Schema}`],
            ["/app/:app/app",       `/v2/app/:app/class/${Class.App}`],
            ["/app/:app/object",    "/v2/app/:app/object"],

            ["/app/:app/device/:object",    "/v2/app/:app/object/:object"],
            ["/app/:app/schema/:object",    "/v2/app/:app/object/:object"],
            ["/app/:app/app/:object",       "/v2/app/:app/object/:object"],
            ["/app/:app/object/:object",    "/v2/app/:app/object/:object"],
            ["/app/:app/class/:class",      "/v2/app/:app/class/:class"],

            ["/class",              "/v2/class"],
            ["/class/:class",       "/v2/class/:class/member"],

            ["/object",             "/v2/object"],
            ["/object/:object",     "/v2/object/:object"],
        ];

        for (const [source, dest] of forwards) {
            const pieces = dest.split("/");
            api.all(source, (req, res, next) => {
                req.url = pieces
                    .map(p => p[0] == ":"
                        ? req.params[p.slice(1)]
                        : p)
                    .join("/");
                this.log("FORWARD: -> %s", req.url);
                req.app.handle(req, res);
            });
        }

        const deny = (req, res) => res.status(403).end();

        /* Deny access to these compat endpoints at this point. Nothing
         * is using them and it's awkward to keep them working. */
        api.post("/app", deny);
        api.get("/app/:app", deny);

        api.get("/app/:app/search", this.config_search.bind(this));
        api.get("/app/:app/class/:class/search", this.config_search.bind(this));

        api.post("/load", this.dump_load.bind(this));

        /* Deny access to /save; it isn't useful until it can be
         * reimplemented to support v2 dumps and ownerships. */
        api.get("/save", deny);
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
        const ok = await this.auth.check_acl(req.auth, Perm.ReadApp, app, true);
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

    /* This is different from /load in that it only accepts v1 dumps.
     * The overwrite query parameter is now ignored: all dumps are
     * authoritative and overwrite existing data. */
    async dump_load(req, res) {
        const dump = req.body;

        if (typeof dump != "object" || dump?.version != 1) {
            this.log("/v1/load can only load version 1 dumps");
            return res.status(422).end();
        }

        req.url = "/load";
        req.app.handle(req, res);
    }
}
