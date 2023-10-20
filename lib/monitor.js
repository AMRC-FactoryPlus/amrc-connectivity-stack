/*
 * ACS Edge Monitor
 * Monitor class
 * Copyright 2023 AMRC
 */

import { Address } from "@amrc-factoryplus/utilities";

export class Monitor {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.address = Address.parse(opts.address);

        this.log = this.fplus.debug.log.bind(this.fplus.debug, "monitor");
    }

    async init () {
        this.app = await this.fplus.MQTT.sparkplug_app();
        this.device = await this.app.device({ address: this.address });

        return this;
    }

    run () {
        this.device.metric("Config_Revision")
            .subscribe(r => this.log("Config revision: %s", r));
    }
}
