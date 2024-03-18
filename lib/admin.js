/*
 * ACS advanced admin interface
 * Web interface backend
 * Copyright 2024 AMRC
 */

import express      from "express";
import { engine }   from "express-handlebars";

import { ServiceClient }    from "@amrc-factoryplus/service-client";

export class Admin {
    constructor (opts) {
        const { env } = opts;

        this.port       = env.PORT;
        this.fplus      = new ServiceClient({ env });
        this.context    = {
            domain:     env.EXTERNAL_DOMAIN,
            http:       env.SECURE ? "https" : "http",
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

        app.get("/", (req, res) => res.render("index", {
            acs,
            page: { title: "Admin" },
        }));
    }

    run () {
        this.app.listen(this.port);
        console.log(`Listening on port ${this.port}`);
    }
}
