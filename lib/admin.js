/*
 * ACS advanced admin interface
 * Web interface backend
 * Copyright 2024 AMRC
 */

import fs           from "fs/promises";

import express      from "express";
import { engine }   from "express-handlebars";

import { ServiceClient, UUIDs } from "@amrc-factoryplus/service-client";

export class Admin {
    constructor (opts) {
        const { env } = opts;

        this.port       = env.PORT;

        this.fplus      = new ServiceClient({ env, verbose: env.VERBOSE });
        this.context    = {
            directory:  env.DIRECTORY_URL,
            domain:     env.EXTERNAL_DOMAIN,
            realm:      env.REALM,
            d_realm:    Object.fromEntries(
                env.OTHER_DOMAINS?.split(",")?.map(d => [d, env.REALM])
                ?? []),
            http:       env.SECURE == "true" ? "https" : "http",
        };
    }

    async init () {
        await this.fplus.init();

        const app = this.app = express();

        this.init_engine();
        this.init_routes();

        return this;
    }

    init_engine () {
        const { app } = this;

        app.engine("handlebars", engine());
        app.set("view engine", "handlebars");
        app.set("views", "./views");
    }

    init_routes () {
        const { app } = this;

        app.get("/", this.index.bind(this));
        app.get("/landing", this.landing.bind(this));
        app.get("/configdb", this.configdb.bind(this));

        app.use(express.static("public", { 
            index:      false,
            redirect:   false,
            maxAge:     "1d",
            immutable:  true,
        }));
    }

    run () {
        this.app.listen(this.port);
        console.log(`Listening on port ${this.port}`);
    }

    async index (req, res) {
        const { context: acs } = this;
        const url = {
            auth:       await this.external(req, 
                UUIDs.Service.Authentication, "./editor"),
            configdb:   await this.external(req, 
                UUIDs.Service.ConfigDB, "./editor"),
        };

        res.render("index", {
            acs, url,
            page: { title: "Advanced admin" },
        });
    }

    async landing (req, res) {
        const { context: acs, krb5_conf } = this;
        return res.format({
            html: async () => {
                const url = Object.fromEntries(
                    ["admin", "manager", "visualiser"]
                    .map(h => [h, `${acs.http}://${h}.${acs.domain}`]));
                url.mqtt = await this.external(req, UUIDs.Service.MQTT);
                res.render("landing", {
                    acs, url,
                    page: { title: "Factory+" },
                });
            },
            json: async () => {
                res.status(200).json({
                    domain:     acs.domain,
                    directory:  acs.directory,
                    krb5:   {
                        realm:  acs.realm,
                        realms: {
                            [acs.realm]:  {
                                kdc:            `kdc.${acs.domain}`,
                                admin_server:   `kadmin.${acs.domain}`,
                            },
                        },
                        domain_realm: acs.d_realm,
                    },
                });
            },
        });
    }

    async configdb (req, res) {
        const { context: acs } = this;
        return res.render("configdb", {
            acs,
            page: {
                title:  "ConfigDB",
                style:  "editor",
                script: "configdb",
            },
        });
    }
                
    async external (req, svc, rel) {
        const [st, specs] = await this.fplus.Directory
            .fetch({
                url:        `v1/service/${svc}`,
                headers:    {
                    "X-Forwarded-Host":     req.get("X-Forwarded-Host"),
                    "X-Forwarded-Proto":    req.get("X-Forwarded-Proto"),
                },
            });
        if (st != 200) {
            console.log("Can't find service %s: %s", svc, st);
            return;
        }
        const base = specs[0]?.url;
        if (!base) {
            console.log("No base URL for service %s", svc);
            return;
        }
        return rel ? new URL(rel, base).toString() : base;
    }
}
