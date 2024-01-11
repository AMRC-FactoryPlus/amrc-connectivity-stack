/* ACS service setup
 * Manager setup
 * Copyright 2024 AMRC
 */

import { ServiceConfig }    from "./service-config.js";
import { ACS }              from "./uuids.js";

export async function setup_manager (ss, helm) {
    const config = await new ServiceConfig({
        ss, 
        service:    ACS.Service.Manager,
        name:       "manager",
    }).init();
    
    config.config.helm = helm.helm;

    await config.finish();
}
