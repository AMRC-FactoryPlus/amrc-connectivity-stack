# Copyright (c) University of Sheffield AMRC 2025.

"""
Binary packing utilities.

These are convenience wrappers around struct.pack() for common data types.

Familiar users can use `struct.pack()` directly: `fromInt32LE(42)` is equivalent to `struct.pack('<i', 42)`
"""

import struct
import json

def fromInt8(value) -> bytes:
    return struct.pack('<b', value)

def fromUInt8(value) -> bytes:
    return struct.pack('<B', value)

def fromInt16LE(value) -> bytes:
    return struct.pack('<h', value)

def fromInt16BE(value) -> bytes:
    return struct.pack('>h', value)

def fromUInt16LE(value) -> bytes:
    return struct.pack('<H', value)

def fromUInt16BE(value) -> bytes:
    return struct.pack('>H', value)

def fromInt32LE(value) -> bytes:
    return struct.pack('<i', value)

def fromInt32BE(value) -> bytes:
    return struct.pack('>i', value)

def fromUInt32LE(value) -> bytes:
    return struct.pack('<I', value)

def fromUInt32BE(value) -> bytes:
    return struct.pack('>I', value)

def fromBigInt64LE(value) -> bytes:
    return struct.pack('<q', value)

def fromBigInt64BE(value) -> bytes:
    return struct.pack('>q', value)

def fromBigUInt64LE(value) -> bytes:
    return struct.pack('<Q', value)

def fromBigUInt64BE(value) -> bytes:
    return struct.pack('>Q', value)

def fromFloatLE(value) -> bytes:
    return struct.pack('<f', value)

def fromFloatBE(value) -> bytes:
    return struct.pack('>f', value)

def fromDoubleLE(value) -> bytes:
    return struct.pack('<d', value)

def fromDoubleBE(value) -> bytes:
    return struct.pack('>d', value)

def fromJSON(value) -> bytes:
    return json.dumps(value).encode('utf-8')

__all__ = [
    'fromInt8',
    'fromUInt8',
    'fromInt16LE',
    'fromInt16BE',
    'fromUInt16LE',
    'fromUInt16BE',
    'fromInt32LE',
    'fromInt32BE',
    'fromUInt32LE',
    'fromUInt32BE',
    'fromBigInt64LE',
    'fromBigInt64BE',
    'fromBigUInt64LE',
    'fromBigUInt64BE',
    'fromFloatLE',
    'fromFloatBE',
    'fromDoubleLE',
    'fromDoubleBE',
    'fromJSON',
]
