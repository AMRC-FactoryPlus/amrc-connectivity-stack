/*
 * ACS MES Collation
 * Route setup
 */

import { APIv1 } from "./api-v1.js";

export function routes (opts) {
    const api_v1 = new APIv1(opts);

    return app => {
        app.set("query parser", "simple");
        app.use("/v1", api_v1.routes);
    };
}
