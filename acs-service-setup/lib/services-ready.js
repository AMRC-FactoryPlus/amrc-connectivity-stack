/* ACS service setup
 * Wait for services to start
 * Copyright 2025 University of Sheffield AMRC
 */

import timers from "timers/promises";

class ServicesReady {
    constructor (ss) {
        this.fplus = ss.fplus;
        this.log = ss.fplus.debug.bound("service");
    }

    async wait_for (service, version) {
        this.log("Waiting for %s (%s)", service.service, version);
        while (!await service.version_satisfies(version)) {
            this.log("Service not ready, waiting 3s");
            await timers.setTimeout(3000);
        }
        this.log("Service %s ready", service.service);
    }

    async run () {
        const { fplus } = this;
        await this.wait_for(fplus.Directory, "1.1.0");
        await this.wait_for(fplus.Auth, "2.0.0");
        await this.wait_for(fplus.ConfigDB, "2.0.0");
    }
}

export function services_ready (ss) {
    return new ServicesReady(ss).run();
}

