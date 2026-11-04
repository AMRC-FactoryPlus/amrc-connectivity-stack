/*
 * Factory+ NodeJS Utilities
 * Name-based (v5) UUIDs, without a dependency
 * Copyright 2026 University of Sheffield AMRC
 *
 * This library runs in the browser as well as in Node, and adds no
 * dependencies: acs-admin installs it from a frozen lockfile. So this
 * file carries its own SHA-1. It is used only to derive stable UUIDs,
 * never for security.
 */

import { Special } from "./uuids.js";

function utf8 (str) {
    return new TextEncoder().encode(str);
}

function rotl (x, n) {
    return (x << n) | (x >>> (32 - n));
}

/** SHA-1 of a byte array, as a Uint8Array of 20 bytes. */
export function sha1 (bytes) {
    const len = bytes.length;
    const words = ((len + 8) >> 6) + 1;
    const w = new Uint32Array(words * 16);
    for (let i = 0; i < len; i++)
        w[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    w[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
    /* Bit length; messages here are far shorter than 2^32 bits. */
    w[words * 16 - 1] = len * 8;

    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe,
        h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const x = new Uint32Array(80);

    for (let blk = 0; blk < w.length; blk += 16) {
        for (let t = 0; t < 16; t++) x[t] = w[blk + t];
        for (let t = 16; t < 80; t++)
            x[t] = rotl(x[t - 3] ^ x[t - 8] ^ x[t - 14] ^ x[t - 16], 1);

        let a = h0, b = h1, c = h2, d = h3, e = h4;
        for (let t = 0; t < 80; t++) {
            let f, k;
            if (t < 20)      { f = (b & c) | (~b & d);          k = 0x5a827999; }
            else if (t < 40) { f = b ^ c ^ d;                   k = 0x6ed9eba1; }
            else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
            else             { f = b ^ c ^ d;                   k = 0xca62c1d6; }
            const tmp = (rotl(a, 5) + f + e + k + x[t]) >>> 0;
            e = d; d = c; c = rotl(b, 30) >>> 0; b = a; a = tmp;
        }
        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }

    const out = new Uint8Array(20);
    [h0, h1, h2, h3, h4].forEach((h, i) => {
        out[i * 4]     = h >>> 24;
        out[i * 4 + 1] = (h >>> 16) & 0xff;
        out[i * 4 + 2] = (h >>> 8) & 0xff;
        out[i * 4 + 3] = h & 0xff;
    });
    return out;
}

function uuid_bytes (uuid) {
    const hex = uuid.replace(/-/g, "");
    if (!/^[0-9a-f]{32}$/i.test(hex))
        throw new RangeError(`Not a UUID: ${uuid}`);
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++)
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
}

/** A v5 UUID for a name in a namespace, as RFC 4122 defines it. */
export function uuid_v5 (name, namespace) {
    const ns = uuid_bytes(namespace);
    const nm = utf8(name);
    const buf = new Uint8Array(ns.length + nm.length);
    buf.set(ns);
    buf.set(nm, ns.length);

    const h = sha1(buf);
    h[6] = (h[6] & 0x0f) | 0x50;
    h[8] = (h[8] & 0x3f) | 0x80;

    const hex = Array.from(h.slice(0, 16),
        b => b.toString(16).padStart(2, "0")).join("");
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
        hex.slice(16, 20), hex.slice(20)].join("-");
}

/** The Instance_UUID of a metric object on a device.
 * This is the scheme acs-edge uses for the objects it adds to a birth
 * certificate: a v5 UUID in the Factory+ namespace from the V5Metric
 * UUID, the device UUID and the object's path. The same device and
 * path always give the same UUID.
 * @arg device The device UUID.
 * @arg path The object's path in the device, e.g. `Alerts/Foo`.
 */
export function metric_instance_uuid (device, path) {
    return uuid_v5([Special.V5Metric, device, path].join(":"),
        Special.FactoryPlus);
}
