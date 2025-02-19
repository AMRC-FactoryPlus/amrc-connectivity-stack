import type { Address } from "../sparkplug/util";
import {ServiceClient, ServiceInterface} from "../service-client";

export type aclFunc = (permission: string, target: string, wild?: boolean) => boolean;

export interface IdentityRequest {
    kerberos?: string;
    uuid?: string;
    sparkplug?: string | Address;
}

export interface Identity {
    uuid: string;
    kerberos?: string;
    sparkplug?: Address;
}

/**
 * Authentication Service for fetching ACLs from the Auth service.
 */
export default class Auth extends ServiceInterface {
    constructor(fplus: ServiceClient);

    root_principal: string;
    permission_group: string;

    /**
     * Checks if the given principal has the given permission on the given target
     * @param principal Kerberos principal
     * @param permission permission group to be verified
     * @param target target to be accessed
     * @param wild Boolean to allow null UUID in the target to be treated as a wildcard
     */
    check_acl(principal: string | IdentityRequest, permission: string, target: string, wild?: boolean): Promise<boolean>;

    /**
     *
     * @param principal Kerberos principal
     * @param group permission group to be verified
     */
    fetch_acl(principal: string, group: string): Promise<aclFunc>;

    /**
     * Locate a principal and return its UUID. Returns null if not found.
     * @param query Object containing a principal name
     */
    resolve_principal(query: { kerberos: string }): Promise<string | null>;

    find_principal(kind?: string, identifier?: string | Address):
        Promise<Identity | undefined>;
}

