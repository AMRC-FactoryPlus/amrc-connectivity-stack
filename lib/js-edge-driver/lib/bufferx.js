/*
 * Copyright (c) University of Sheffield AMRC 2025.
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
    ...(ended.map(([t, s]) => [`to${t}`, Buffer.prototype[`read${t}`], s])
    .map(([n, r, s]) =>
      [n, buf => r.call(buf, 0)])),
    ["toJSON", buf => JSON.parse(buf.toString())],
]);
