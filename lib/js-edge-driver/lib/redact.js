/*
 * ACS Edge Agent driver library
 * Redact secrets from values before they are logged.
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* The Edge Agent substitutes secrets into the driver config before
 * sending it, so the config we receive can contain plaintext
 * credentials. We can't know every driver's field names, so match on
 * the key instead. This errs towards masking too much; it only
 * affects what is logged. */
const SENSITIVE = /pass|pwd|secret|token|key|cred/i;
const MASK = "***";

/* Credentials embedded in a URL, e.g. mqtt://user:pass@host. */
const URL_USERINFO = /(\/\/[^/:@\s]*):[^/\s]*@/g;

/** Return a copy of `value` that is safe to log.
 * Values under sensitive keys are masked, recursively, but the keys
 * themselves are kept so the log still shows the config's shape. The
 * original value is not modified.
 * @param value Any JSON-like value.
 */
export function redact (value) {
    if (typeof value == "string")
        return value.replace(URL_USERINFO, `$1:${MASK}@`);
    if (Array.isArray(value))
        return value.map(redact);
    if (value == null || typeof value != "object")
        return value;

    return Object.fromEntries(
        Object.entries(value).map(([k, v]) =>
            [k, SENSITIVE.test(k) && v != null && v !== "" ? MASK : redact(v)]));
}
