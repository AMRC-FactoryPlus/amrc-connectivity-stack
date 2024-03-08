/*
 * Factory+ NodeJS Utilities
 * Command Escalation service interface.
 * Copyright 2023 AMRC.
 */

import { Address } from "../sparkplug/util.js";
import { Service } from "../uuids.js";

import { ServiceInterface } from "./service-interface.js";

export default class CmdEsc extends ServiceInterface {
    constructor (fplus) {
        super(fplus);
        this.service = Service.Command_Escalation;
        this.log = this.debug.log.bind(this.debug, "cmdesc");
    }

    async request_cmd ({ address, name, type, value }) {
        const [st] = await this.fetch({
            method:     "POST",
            url:        `v1/address/${address}`,
            body:       { name, type, value },
        });
        if (st != 200)
            this.throw(`Can't set metric ${name} of ${address}`, st);
    }
    
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
