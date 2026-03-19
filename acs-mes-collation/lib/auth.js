/*
 * ACS MES Collation
 * ACL handling
 */

import { Perm } from "./constants.js";

export class Auth {
    constructor (opts) {
        this.auth = opts.fplus.Auth;
        this.root = this.auth.root_principal;
        this.log = opts.fplus.debug.bound("authz");
    }

    fetch_acl (principal) {
        return this.auth.fetch_acl(principal, Perm.All);
    }

    async check_acl (principal, permission, target, wild) {
        const acl = await this.fetch_acl(principal);
        return acl(permission, target, wild);
    }
}
