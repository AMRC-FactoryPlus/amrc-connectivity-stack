/*
 * ACS Auth service
 * ACL handling
 * Copyright 2024 University of Sheffield
 */

export class Auth {
    constructor (opts) {
    }

    async check_acl(principal, permission, target, wild) {
        /* XXX No ACLs for now */
        return () => true;
    }
}
