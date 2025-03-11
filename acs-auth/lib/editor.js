/*
 * Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
 * Serve the editor GUI.
 * Copyright 2022 AMRC
 */

import url from "node:url";

import express from "express";

import {Debug} from "@amrc-factoryplus/service-client";

const debug = new Debug();

export default class Editor {
    constructor(opts) {
        this.services = opts.services;

        this.routes = express.Router();
    }

    init() {
        const app = this.routes;

        /* Editor config information */
        app.get("/services", (q, p) =>
            p.status(200).json(this.services));

        /* Return the supplied creds */
        app.get("/creds", (q, p) =>
            p.status(200)
                .type("text/plain")
                .send(q.get("Authorization")))

        /* Serve the editor */
        const editor = url.fileURLToPath(new URL("../editor", import.meta.url));
        debug.log("editor", `Serving editor out of ${editor}`);
        app.use("/", express.static(editor));

        return this;
    }
}
