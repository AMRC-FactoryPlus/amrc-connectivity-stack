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
        //this.log("📤 DATA called with spec: '%s'", spec);
        //this.log("📋 Available topics map: %O", this.topics);

        const dtopic = this.topics?.get(spec);
        if (!dtopic) {
            //this.log("❌ No topic found for spec '%s' - cannot publish!", spec);
            return;
        }

        //this.log("✅ Publishing to topic ID: %s", dtopic);
        const mtopic = this.topic("data", dtopic);
        //this.log("📡 Full MQTT topic: %s", mtopic);
        return this.mqtt.publishAsync(mtopic, buf);
    }
}
