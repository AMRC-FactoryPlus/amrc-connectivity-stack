/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * ETag utility functions
 * Copyright 2023 AMRC
 */

import {Debug} from "@amrc-factoryplus/utilities";

const debug = new Debug();
const log = debug.log.bind(debug, "etag");

/* An ETag consists of an opaque string and a type. Currently there are
 * two types: strong and weak. */
export class ETag {
    constructor (opaque, weak) {
        this.opaque = opaque;
        this.weak = weak ?? false;
    }

    static parse (str) {
        /* Pattern from RFC7232 sec 2.3 */
        const match = str.match(/^(W\/)?"([\x21\x23-\x7e\x90-\xff]*)"$/);

        if (!match) return null;
        return new ETag(match[2], match[1] != undefined);
    }

    strong_compare (other) {
        log("Strong comparing %o vs %o", this, other);
        if (this.weak || other.weak)
            return false;
        return this.opaque == other.opaque;
    }

    weak_compare (other) {
        log("Weak comparing %o vs %o", this, other);
        return this.opaque == other.opaque;
    }
}

/* I am not convinced this is entirely correct, but it is equivalent to
 * what express's fresh module does. This will not correctly handle
 * etags containing commas, which I think are permitted. */
function parse_etags (header) {
    const etags = header.split(/ *, */)
        .map(tok => ETag.parse(tok));
    if (etags.includes(null))
        return null;
    return etags;
}

function trim (header) {
    return header?.replace(/^ *| *$/, "");
}

/* Check a request against an etag. Pass null to indicate the
 * resource does not exist. This function does not handle the case of a
 * resource which exists but has no etag. */
export function check_match_headers (req, opaque, weak) {
    const exists = opaque != null;
    const etag = new ETag(opaque, weak);
    log("Checking %s against DB etag %o", req.method, etag);

    const match = trim(req.header("If-Match"));
    log("If-Match: %s", match);
    if (match == "*") {
        if (!exists) {
            log("If-Match *, no resource");
            return 412;
        }
    }
    else if (match != undefined) {
        const tags = parse_etags(match);
        log("Checking If-Match etags: %o", tags);
        if (tags == null) return 400;
        if (!tags.some(t => t.strong_compare(etag)))
            return 412;
    }

    const none = trim(req.header("If-None-Match"));
    const fail = req.method == "GET" || req.method == "HEAD" ? 304 : 412;
    log("If-None-Match: %s", none);
    if (none == "*") {
        if (exists) {
            log("If-None-Match *, existing resource");
            return fail;
        }
    }
    else if (none != undefined) {
        const tags = parse_etags(none);
        log("Checking If-N-Match etags: %o", tags);
        if (tags == null) return 400;
        if (tags.some(t => t.weak_compare(etag)))
            return fail;
    }

    return;
}

export function checker (req) {
    return etag => check_match_headers(req, etag);
}

