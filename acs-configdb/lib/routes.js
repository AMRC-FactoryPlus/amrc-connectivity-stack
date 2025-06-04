/*
 * ACS ConfigDB
 * Express routing
 * Copyright 2024 University of Sheffield AMRC
 */

import url from "url";

import express from "express";

import { APIv1 } from "./api-v1.js";
import { APIv2 } from "./api-v2.js";
import { Loader } from "./load.js";

export function routes (opts) {
    const { fplus, mqtt } = opts;
 
    const api_v1 = new APIv1(opts);
    const api_v2 = new APIv2(opts);
    const loader = new Loader(opts);

    /* XXX This is evil. Either it should go or it should be driven from
     * the notify interface. */
    if (mqtt)
        api_v2.setup_mqtt_link(mqtt);

    return app => {
        /* No fancy query-string parsing */
        app.set("query parser", "simple");

        /* We need req.hostname to work correctly. These values are only
         * reflected to the client to spoofing is not a problem. */
        app.set("trust proxy", true);

        app.use(express.json({ type: "application/merge-patch+json" }));

        /* Serve the editor */
        const editor = url.fileURLToPath(new URL("../editor", import.meta.url));
        fplus.debug.log("editor", `Serving editor out of ${editor}.`);
        app.use("/editor", express.static(editor));

        app.use("/load", loader.routes);
        app.use("/v1", api_v1.routes);
        app.use("/v2", api_v2.routes);
    };
}

