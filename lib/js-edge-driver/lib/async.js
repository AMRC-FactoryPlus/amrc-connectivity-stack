/* AMRC Connectivity Stack
 * Edge Agent driver library
 * Copyright 2024 AMRC
 */

import { Driver } from "./driver.js";

export class AsyncDriver extends Driver {
    constructor (opts) {
        super(opts);
    }

    async data (spec, buf) {
        this.log("DATA [%s] %o", spec, buf);

        const dtopic = this.topics?.get(spec);
        if (!dtopic) {
            this.log("Edge Agent not subscribed, ignoring");
            return;
        }

        const mtopic = this.topic("data", dtopic);
        this.log("Publishing to %s", mtopic);
        return this.mqtt.publishAsync(mtopic, buf);
    }
}
