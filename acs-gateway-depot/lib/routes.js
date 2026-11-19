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
        app.use("/v1", api_v1.routes);
    };
}
