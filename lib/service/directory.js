/*
 * Factory+ NodeJS Utilities
 * Directory service interface.
 * Copyright 2023 AMRC.
 */

import { Address } from "../sparkplug/util.js";
import { Service, Null as Null_UUID } from "../uuids.js";

import { ServiceInterface } from "./service-interface.js";

export default class Directory extends ServiceInterface {
    constructor (fplus) {
        super(fplus);
        this.service = Service.Directory;
        this.log = this.debug.log.bind(this.debug, "directory");
    }

    async get_service_info (service) {
        const [st, specs] = await this.fetch(`/v1/service/${service}`);
        if (st == 404) {
            this.log("Can't find service %s: %s", service, st);
            return;
        }
        if (st != 200)
            this.throw(`Can't get service records for ${service}`, st);
        if (!Array.isArray(specs))
            this.throw(`Invalid service response for ${service}`);
        if (specs.length > 1)
            this.throw(`More than one service record for ${service}`);

        return specs[0];
    }
    
    async get_service_url (service) {
        const spec = await this.get_service_info(service);
        return spec?.url;
    }

    /* XXX Endpoint for compatibility. This will only ever return a
     * single result. */
    async get_service_urls (service) {
        const url = await this.get_service_url(service);
        return url ? [url] : undefined;
    }

    async register_service_url (service, url) {
        const [st] = await this.fetch({
            method:     "PUT", 
            url:        `v1/service/${service}/advertisment`,
            body:       { url },
        });
        if (st != 204)
            this.throw(`Can't register service ${service}`, st);
        this.log("Registered %s for %s", url, service);
    }

    async get_device_info (device) {
        const [st, info] = await this.fetch(`v1/device/${device}`);
        if (st == 404) return;
        if (st != 200)
            this.throw(`Can't find device ${device}`, st);
        return info;
    }

    async get_device_address (device) {
        const info = await this.get_device_info(device);
        if (!info) return;
        return new Address(info.group_id, info.node_id, info.device_id);
    }
}
