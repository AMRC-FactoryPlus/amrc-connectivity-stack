/*
 * Factory+ NodeJS Utilities
 * Command Escalation service interface.
 * Copyright 2023 AMRC.
 */

import { Service } from "../uuids.js";

import { ServiceInterface } from "./service-interface.js";

/** Interface to the Command Escalation service. */
export class CmdEsc extends ServiceInterface {
    /** Private. Construct via ServiceClient. */
    constructor (fplus) {
        super(fplus);
        this.service = Service.Command_Escalation;
        this.log = this.debug.log.bind(this.debug, "cmdesc");
    }

    /** Request a CMD.
     * Accepts an object of parameters.
     * @arg address A Sparkplug address, as a string or an Address.
     * @arg name The metric name.
     * @arg type The Sparkplug metric type.
     * @arg value The value to set the metric to.
     */
    async request_cmd ({ address, name, type, value }) {
        const [st] = await this.fetch({
            method:     "POST",
            url:        `v1/address/${address}`,
            body:       { name, type, value },
        });
        if (st != 200)
            this.throw(`Can't set metric ${name} of ${address}`, st);
    }
    
    /** Send a rebirth CMD.
     * @arg address An {Address} object.
     */
    async rebirth (address) {
        const ctrl = address.isDevice() ? "Device Control" : "Node Control";
        await this.request_cmd({
            address:    address,
            name:       `${ctrl}/Rebirth`,
            type:       "Boolean",
            value:      true,
        });
    }
}
