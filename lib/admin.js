/*
 * ACS advanced admin interface
 * Web interface backend
 * Copyright 2024 AMRC
 */

import express      from "express";
import { engine }   from "express-handlebars";

import { ServiceClient, UUIDs } from "@amrc-factoryplus/service-client";

export class Admin {
    constructor (opts) {
        const { env } = opts;

        this.port       = env.PORT;
        this.fplus      = new ServiceClient({ env, verbose: env.VERBOSE });
        this.context    = {
            domain:     env.EXTERNAL_DOMAIN,
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
        const { app, context: acs } = this;

        app.get("/", async (req, res) => {
            const url = {
                auth:       await this.editor(req, UUIDs.Service.Authentication),
                configdb:   await this.editor(req, UUIDs.Service.ConfigDB),
                manager:    `${acs.http}://manager.${acs.domain}`,
                vis:        `${acs.http}://visualiser.${acs.domain}`,
            };

            res.render("index", {
                acs, url,
                page: { title: "Admin" },
            });
        });
    }

    run () {
        this.app.listen(this.port);
        console.log(`Listening on port ${this.port}`);
    }

    async editor (req, svc) {
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
        return new URL("./editor", base).toString();
    }
}
