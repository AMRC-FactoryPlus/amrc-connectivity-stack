/*
 * ACS Data Access service
 * Data validation routines
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


export function valid_datetime(datetime_str){
    // 1. Check the exact string format using RegEx
    const regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    if (!regex.test(datetime_str)) return false;

    // 2. Check if the calendar date and time are physically valid
    const timestamp = Date.parse(datetime_str);
    if (isNaN(timestamp)) return false;

    // 3. Ensure it matches the original string (prevents date rolling like Feb 30 -> Mar 2)
    return new Date(timestamp).toISOString() === datetime_str;
}