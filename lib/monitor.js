/*
 * ACS Edge Monitor
 * Monitor class
 * Copyright 2023 AMRC
 */

import { Address } from "@amrc-factoryplus/utilities";

export class Monitor {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.node = opts.node;

        this.log = this.fplus.debug.log.bind(this.fplus.debug, "monitor");
    }

    async init () {
        this.app = await this.fplus.MQTT.sparkplug_app();
        this.device = await this.app.device({ node: this.node });

        return this;
    }

    run () {
        this.device.metric("Config_Revision")
            .subscribe(r => this.log("Config revision: %s", r));
    }
}
