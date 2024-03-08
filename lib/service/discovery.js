/*
 * Factory+ NodeJS Utilities
 * Service discovery.
 * Copyright 2022 AMRC.
 */

import { Service } from "../uuids.js";

import { ServiceInterface } from "./service-interface.js";

export default class Discovery extends ServiceInterface {
    constructor (fplus) {
        super(fplus);
        this.urls = new Map();

        const opts = fplus.opts;
        const presets = [
            [opts.authn_url,        Service.Authentication],
            [opts.configdb_url,     Service.ConfigDB],
            [opts.directory_url,    Service.Directory],
            [opts.mqtt_url,         Service.MQTT],
        ];
        for (const [pr, srv] of presets) {
            if (pr == null) continue;
            this.debug.log("discovery", "Preset URL for %s: %s", srv, pr);
            this.set_service_url(srv, pr);
        }
    }

    /* We have a service URL from somewhere... */
    set_service_url (service, url) {
        this.urls.set(service, url);
    }

    /* We know how to find service URLs (hook for the Directory) */
    set_service_discovery (locator) {
        this.find_service_urls = locator;
    }

    find_service_urls (service) {
        return this.fplus.Directory.get_service_urls(service);
    }

    /* This interface is deprecated. The concept of 'multiple providers
     * for a service' was never properly implemented. */
    async service_urls (service) {
        this.debug.log("service", `[${service}] Looking for URL...`);
        if (this.urls.has(service)) {
            const url = this.urls.get(service);
            this.debug.log("service", `[${service}] Found ${url} preconfigured.`);
            return [url];
        }

        const urls = await this.find_service_urls(service);

        if (urls) {
            this.debug.log("service", "[%s] Discovery returned %s",
                service, urls.join(", "));
            return urls;
        } else {
            return [];
        }
    }

    async service_url (service) {
        const urls = await this.service_urls(service);
        return urls?.[0];
    }
}
