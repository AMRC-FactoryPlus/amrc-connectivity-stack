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
        this.log("DATA %O", buf);
        const dtopic = this.topics?.get(spec);
        if (!dtopic) return;

        const mtopic = this.topic("data", dtopic);
        return this.mqtt.publishAsync(mtopic, buf);
    }
}
