/*
 * Factory+ NodeJS Utilities
 * Directory service interface.
 * Copyright 2023 AMRC.
 */

import { Address } from "../sparkplug/util.js";
import { Service } from "../uuids.js";

import { ServiceInterface } from "./service-interface.js";

/** Directory service interface. */
export class Directory extends ServiceInterface {
    /** Private. Construct via ServiceClient. */
    constructor (fplus) {
        super(fplus);
        this.service = Service.Directory;
        this.log = this.debug.log.bind(this.debug, "directory");
    }

    /** Fetch the full service record for a registration.
     * Given a service UUID, this fetches the full service record. This
     * will be an object with these keys, all optional:
     *
     * - `url`: The HTTP endpoint URL
     * - `device`: The device UUID of the Sparkplug interface
     *
     * If `device` is the all-zeros UUID then the service has no
     * Sparkplug interface.
     *
     * If there is more than one record for the service this will throw
     * an exception. This is impossible with the v4 Directory.
     *
     * @arg service A service UUID
     * @returns A service registration object
     */
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
    
    /** Fetch the registered URL for a service.
     * This will throw if more than one service record has been
     * registered. 
     * @arg service The service UUID
     * @returns The service URL, or `undefined`
     */
    async get_service_url (service) {
        const spec = await this.get_service_info(service);
        return spec?.url;
    }

    /** @deprecated */
    async get_service_urls (service) {
        const url = await this.get_service_url(service);
        return url ? [url] : undefined;
    }

    /** Register a service URL with the Directory.
     * Service registration should be performed by service-setup in ACS
     * v4.
     * @deprecated
     */
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

    /** Fetch the record for a device.
     * A device in this context is a Sparkplug Node or Device. This
     * returns an object with these keys:
     *
     * - `uuid`: The device UUID
     * - `group_id`: The Sparkplug Group
     * - `node_id`: The Sparkplug Node
     * - `device_id`: The Sparkplug Device, or `undefined`
     * - `last_change`: When the device last came on/offline (ms)
     * - `top_schema`: The UUID of the top-level schema UUID
     * - `schemas`: An Array of all schema UUIDs.
     *
     * @arg device A device UUID
     * @returns An object as above, or `undefined`.
     */
    async get_device_info (device) {
        const [st, info] = await this.fetch(`v1/device/${device}`);
        if (st == 404) return;
        if (st != 200)
            this.throw(`Can't find device ${device}`, st);
        return info;
    }

    /** Fetch the address of a device.
     * @arg device A device UUID
     * @returns An {Address} object.
     */
    async get_device_address (device) {
        const info = await this.get_device_info(device);
        if (!info) return;
        return new Address(info.group_id, info.node_id, info.device_id);
    }
}
