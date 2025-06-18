/*
 * ACS ConfigDB
 * ACL handling
 * Copyright 2024 University of Sheffield
 */

import { Perm } from "./constants.js";

export class Auth {
    constructor (opts) {
        this.auth = opts.fplus.Auth;
        this.root = this.auth.root_principal;
        this.log = opts.fplus.debug.bound("authz");
    }

    async check_acl(principal, permission, target, wild) {
        const acl = await this.auth.fetch_acl(principal, Perm.All);
        return acl(permission, target, wild);
    }

    is_root (principal) {
        return this.root &&  principal == this.root;
    }
}
