/*
 * Factory+ NodeJS Utilities
 * Service discovery.
 * Copyright 2022 AMRC.
 */

import { Service } from "../uuids.js";

import { ServiceInterface } from "./service-interface.js";

/** Perform service discovery.

The Discovery discovers the URLs used to contact the services. Primarily
this happens via the Directory but facilities are provided to override
URLs for testing.

Options (provided via the ServiceClient) are:

- `directory_url`: (required) The URL of the Directory.
- `authn_url`: The URL of the Auth service.
- `configdb_url`: The URL of the ConfigDB.
- `mqtt_url`: The URL of the MQTT broker.

*/
export class Discovery extends ServiceInterface {
    /** Private. Construct via the ServiceClient. */
    constructor (fplus) {
        super(fplus);
        this.urls = new Map();

        const opts = fplus.opts;
        const presets = [
            [opts.authn_url,        Service.Authentication],
            [opts.configdb_url,     Service.ConfigDB],
            [opts.directory_url,    Service.Directory],
            [opts.mqtt_url,         Service.MQTT],
            [opts.files_url,        Service.Files],
        ];
        for (const [pr, srv] of presets) {
            if (pr == null) continue;
            this.debug.log("discovery", "Preset URL for %s: %s", srv, pr);
            this.set_service_url(srv, pr);
        }
    }

    /** Override a service URL.
     * This is a hook for situations where we must override resolution
     * via the Directory.
     * @arg service A service UUID
     * @arg url The URL to return in future
     */
    set_service_url (service, url) {
        this.urls.set(service, url);
    }

    /** Replace the resolution via the Directory.
     * This is primarily a hook for the Directory itself to use. The
     * function provided must accept a service UUID and return a Promise
     * to an array of URLs. 
     * @arg locater The replacement resolution function
     */
    set_service_discovery (locator) {
        this.find_service_urls = locator;
    }

    /* private */
    find_service_urls (service) {
        return this.fplus.Directory.get_service_urls(service);
    }

    /** Look up the URLs for a service.
     * Although this returns an array, with the current Directory this
     * will never have more than one entry.
     * @arg service A service UUID
     * @returns An Array of URLs.
     * @deprecated
     */
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

    /** Look up the URL for a service.
     * @arg service A service UUID
     * @returns A service URL, or `undefined`.
     */
    async service_url (service) {
        const urls = await this.service_urls(service);
        return urls?.[0];
    }
}
