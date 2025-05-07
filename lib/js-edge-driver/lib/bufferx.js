/*
 * ACS edge driver library
 * Buffer conversion functions
 * Copyright 2024 AMRC
 */

import { Buffer } from "buffer";

const types = {
    BigInt64:   8,
    BigUInt64:  8,
    Int32:      4,
    UInt32:     4,
    Int16:      2,
    UInt16:     2,
    Int8:       1,
    UInt8:      1,
    Double:     8,
    Float:      4,
};

const ended = Object.entries(types)
    .flatMap(([t, s]) =>
        s > 1 ? [[`${t}LE`, s], [`${t}BE`, s]] : [[t, s]]);

export const BufferX = Object.fromEntries([
    ...(ended.map(([t, s]) => [`from${t}`, Buffer.prototype[`write${t}`], s])
        .map(([n, w, s]) => 
            [n, v => {
                const buf = Buffer.allocUnsafe(s);
                w.call(buf, v);
                return buf;
            }])),
    ["fromJSON", j => Buffer.from(JSON.stringify(j))],
]);
