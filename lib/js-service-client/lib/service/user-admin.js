/*
 * Factory+ NodeJS Utilities
 * User Admin service interface.
 * Copyright 2026 University of Sheffield
 */

import { Service } from "../uuids.js";

import { ServiceInterface } from "./service-interface.js";

/** Interface to the User Admin service. */
export class UserAdmin extends ServiceInterface {
    /** Private. Construct via ServiceClient. */
    constructor (fplus) {
        super(fplus);
        this.service = Service.UserAdmin;
    }

    /** Create a new human user.
     * Creates a Kerberos principal, a ConfigDB HumanUser object, and
     * links the two, in a single synchronous call.
     * @arg name The user's display name.
     * @arg principal The Kerberos principal name to create.
     * @arg password The initial password for the new principal.
     * @arg groups A list of ConfigDB group UUIDs to add the new user to.
     * @returns The UUID of the new ConfigDB object.
     */
    async create_user ({ name, principal, password, groups }) {
        const [st, body] = await this.fetch({
            method:     "POST",
            url:        "v1/user",
            body:       { name, principal, password, groups },
        });
        if (st != 201)
            this.throw(`Can't create user ${principal}`, st, body);
        return body.uuid;
    }
}
