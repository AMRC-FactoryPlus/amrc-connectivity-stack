/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * ETag utility functions
 * Copyright 2023 AMRC
 */

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
        if (this.weak || other.weak)
            return false;
        return this.opaque == other.opaque;
    }

    weak_compare (other) {
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

    const match = trim(req.header("If-Match"));
    if (match == "*") {
        if (!exists) return false;
    }
    else if (match != undefined) {
        const tags = parse_etags(match);
        if (tags == null) return null;
        if (!tags.some(t => t.strong_compare(etag)))
            return false;
    }

    const none = trim(req.header("If-None-Match"));
    if (none == "*") {
        if (exists) return false;
    }
    else if (none != undefined) {
        const tags = parse_etags(none);
        if (tags == null) return null;
        if (tags.some(t => t.weak_compare(etag)))
            return false;
    }

    return true;
}
