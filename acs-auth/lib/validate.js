/*
 * ACS Auth service
 * Data validation routines
 * Copyright 2025 University of Sheffield AMRC
 */

export const UUID_rx = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const KRB_rx = /^[a-zA-Z0-9_./-]+@[A-Za-z0-9-.]+$/;

export const booleans = {
    undefined: false,
    "true": true, "false": false,
    "1": true, "0": false,
    on: true, off: false,
    yes: true, no: false,
};

export function valid_uuid(uuid) {
    if (UUID_rx.test(uuid))
        return true;
    //debug.log("debug", `Ignoring invalid UUID [${uuid}]`);
    return false;
}

export function valid_krb(krb) {
    if (KRB_rx.test(krb))
        return true;
    //debug.log("debug", `Ignoring invalid principal [${krb}]`);
    return false;
}

export function valid_grant (grant) {
    if (!valid_uuid(grant.principal)) return false;
    if (!valid_uuid(grant.permission)) return false;
    if (!valid_uuid(grant.target)) return false;
    return (grant.plural === true || grant.plural === false);
}
