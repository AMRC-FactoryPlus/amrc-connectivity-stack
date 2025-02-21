# Buffer construction functions

    import { BufferX } from "@amrc-factoryplus/edge-driver";

    constt buf = BufferX.fromDoubleLE(24.5);

This object provides static functions for constructing Buffers. The
following functions are provided. In this list `%e` indicates either
`BE` or `LE` for big- or little-endian conversions. See the `write*`
methods on Buffer for full details.

    fromBigInt64%e
    fromBigUInt64%e
    fromInt32%e
    fromUInt32%e
    fromInt16%e
    fromUInt16%e
    fromInt8
    fromUInt8
    fromDouble%e
    fromFloat%e
    fromJSON
