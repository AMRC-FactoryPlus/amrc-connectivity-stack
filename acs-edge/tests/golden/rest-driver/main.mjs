/*
 * ACS Edge Agent
 * Golden-output harness: a reference REST split driver
 * Copyright 2026 University of Sheffield
 *
 * Test support only, not a product driver. It proves the harness by
 * doing what the built-in REST connection does, as a split driver: GET
 * baseURL + address and pass the body through as raw bytes, for the
 * Edge Agent to parse with the device's payload format. Like the
 * built-in connection it publishes only on a 200 response and adds
 * Basic auth when the connection asks for it.
 *
 * It needs lib/js-edge-driver's dependencies installed (`npm ci` in
 * that directory). Run it with EDGE_MQTT, EDGE_USERNAME and
 * EDGE_PASSWORD set, as the agent's sidecars are.
 */

import { PolledDriver } from "../../../../lib/js-edge-driver/lib/index.js";

class RestHandler {
    static create (driver, conf) {
        if (typeof conf?.baseURL != "string") {
            driver.log("No baseURL in the connection config");
            return;
        }
        return new RestHandler(driver, conf);
    }

    constructor (driver, conf) {
        this.log = driver.debug.bound("rest");
        this.base = conf.baseURL;
        this.headers = { Accept: "*/*" };
        if (conf.authMethod == "Basic") {
            const token = Buffer.from(`${conf.username}:${conf.password}`)
                .toString("base64");
            this.headers.Authorization = `Basic ${token}`;
        }
    }

    async connect () {
        return "UP";
    }

    /* The address is the path to append to the base URL. */
    parseAddr (addr) {
        return addr;
    }

    async poll (addr) {
        try {
            const res = await fetch(this.base + addr, { headers: this.headers });
            const body = Buffer.from(await res.arrayBuffer());
            if (res.status == 200) return body;
            this.log("GET %s: status %s", addr, res.status);
        }
        catch (e) {
            this.log("GET %s failed: %s", addr, e.message);
        }
    }
}

const drv = new PolledDriver({
    env:        process.env,
    handler:    RestHandler,
    serial:     false,
});
drv.run();
