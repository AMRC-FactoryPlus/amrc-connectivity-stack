/*
 * ACS Gateway Depot
 * Route setup.
 * Copyright 2026 University of Sheffield AMRC
 */

import { APIv1 } from "./api-v1.js";

/* Requests from gateways carry no Factory+ credentials. */
export const PUBLIC = "/v1/(box|payload)/(.*)";

export function routes (opts) {
    const api_v1 = new APIv1(opts);

    return app => {
        /* The Admin UI polls this API to show gateways as they arrive,
         * so a browser must never answer from its cache. This replaces
         * the cluster-wide CACHE_MAX_AGE. */
        app.use((req, res, next) => {
            res.set("Cache-Control", "no-store");
            next();
        });
        app.use("/v1", api_v1.routes);
    };
}
