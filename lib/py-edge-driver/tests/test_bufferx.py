# Copyright (c) University of Sheffield AMRC 2025.

import struct
import pytest

import amrc.factoryplus.edge_driver.bufferx as BufferX

def test_from_int8():
    """
    Test encoding a signed integer as an 8-bit value.
    """
    assert BufferX.fromInt8(42) == b'*'
    assert BufferX.fromInt8(-42) == b'\xd6'
    assert BufferX.fromInt8(0) == b'\x00'
    assert BufferX.fromInt8(127) == b'\x7f'
    assert BufferX.fromInt8(-128) == b'\x80'

def test_from_uint8():
    """
    Test encoding an unsigned integer as an 8-bit value.
    """
    assert BufferX.fromUInt8(42) == b'*'
    assert BufferX.fromUInt8(0) == b'\x00'
    assert BufferX.fromUInt8(255) == b'\xff'
    with pytest.raises(struct.error):
        BufferX.fromUInt8(-42)

def test_from_int16():
    """
    Test encoding a signed integer as a 16-bit value.
    """
    assert BufferX.fromInt16LE(42) == b'*\x00'
    assert BufferX.fromInt16LE(-42) == b'\xd6\xff'
    assert BufferX.fromInt16BE(42) == b'\x00*'
    assert BufferX.fromInt16BE(-42) == b'\xff\xd6'
    assert BufferX.fromInt16LE(0) == b'\x00\x00'
    assert BufferX.fromInt16LE(32767) == b'\xff\x7f'
    assert BufferX.fromInt16LE(-32768) == b'\x00\x80'

def test_from_uint16():
    """
    Test encoding an unsigned integer as a 16-bit value.
    """
    assert BufferX.fromUInt16LE(42) == b'*\x00'
    assert BufferX.fromUInt16BE(42) == b'\x00*'
    assert BufferX.fromUInt16LE(0) == b'\x00\x00'
    assert BufferX.fromUInt16LE(65535) == b'\xff\xff'
    with pytest.raises(struct.error):
        BufferX.fromUInt16LE(-42)
    with pytest.raises(struct.error):
        BufferX.fromUInt16BE(-42)

def test_from_int32():
    """
    Test encoding a signed integer as a 32-bit value.
    """
    assert BufferX.fromInt32LE(42) == b'*\x00\x00\x00'
    assert BufferX.fromInt32LE(-42) == b'\xd6\xff\xff\xff'
    assert BufferX.fromInt32BE(42) == b'\x00\x00\x00*'
    assert BufferX.fromInt32BE(-42) == b'\xff\xff\xff\xd6'
    assert BufferX.fromInt32LE(0) == b'\x00\x00\x00\x00'
    assert BufferX.fromInt32LE(2147483647) == b'\xff\xff\xff\x7f'
    assert BufferX.fromInt32LE(-2147483648) == b'\x00\x00\x00\x80'

def test_from_uint32():
    """
    Test encoding an unsigned integer as a 32-bit value.
    """
    assert BufferX.fromUInt32LE(42) == b'*\x00\x00\x00'
    assert BufferX.fromUInt32BE(42) == b'\x00\x00\x00*'
    assert BufferX.fromUInt32LE(0) == b'\x00\x00\x00\x00'
    assert BufferX.fromUInt32LE(4294967295) == b'\xff\xff\xff\xff'
    with pytest.raises(struct.error):
        BufferX.fromUInt32LE(-42)
    with pytest.raises(struct.error):
        BufferX.fromUInt32BE(-42)

def test_from_int64():
    """
    Test encoding a signed integer as a 64-bit value.
    """
    assert BufferX.fromBigInt64LE(42) == b'*\x00\x00\x00\x00\x00\x00\x00'
    assert BufferX.fromBigInt64LE(-42) == b'\xd6\xff\xff\xff\xff\xff\xff\xff'
    assert BufferX.fromBigInt64BE(42) == b'\x00\x00\x00\x00\x00\x00\x00*'
    assert BufferX.fromBigInt64BE(-42) == b'\xff\xff\xff\xff\xff\xff\xff\xd6'
    assert BufferX.fromBigInt64LE(0) == b'\x00\x00\x00\x00\x00\x00\x00\x00'

def test_from_uint64():
    """
    Test encoding an unsigned integer as a 64-bit value.
    """
    assert BufferX.fromBigUInt64LE(42) == b'*\x00\x00\x00\x00\x00\x00\x00'
    assert BufferX.fromBigUInt64BE(42) == b'\x00\x00\x00\x00\x00\x00\x00*'
    assert BufferX.fromBigUInt64LE(0) == b'\x00\x00\x00\x00\x00\x00\x00\x00'
    with pytest.raises(struct.error):
        BufferX.fromBigUInt64LE(-42)
    with pytest.raises(struct.error):
        BufferX.fromBigUInt64BE(-42)

def test_from_float():
    """
    Test encoding a floating-point number as a 32-bit value.
    """
    assert BufferX.fromFloatLE(42.0) == b'\x00\x00(B'
    assert BufferX.fromFloatLE(-42.0) == b'\x00\x00(\xc2'
    assert BufferX.fromFloatBE(42.0) == b'B(\x00\x00'
    assert BufferX.fromFloatBE(-42.0) == b'\xc2(\x00\x00'
    assert BufferX.fromFloatLE(0.0) == b'\x00\x00\x00\x00'
    assert BufferX.fromFloatLE(1.5) == b'\x00\x00\xc0?'

def test_from_double():
    """
    Test encoding a floating-point number as a 64-bit value.
    """
    assert BufferX.fromDoubleLE(42.0) == b'\x00\x00\x00\x00\x00\x00E@'
    assert BufferX.fromDoubleLE(-42.0) == b'\x00\x00\x00\x00\x00\x00E\xc0'
    assert BufferX.fromDoubleBE(42.0) == b'@E\x00\x00\x00\x00\x00\x00'
    assert BufferX.fromDoubleBE(-42.0) == b'\xc0E\x00\x00\x00\x00\x00\x00'
    assert BufferX.fromDoubleLE(0.0) == b'\x00\x00\x00\x00\x00\x00\x00\x00'
    assert BufferX.fromDoubleLE(1.5) == b'\x00\x00\x00\x00\x00\x00\xf8?'

def test_from_json():
    """
    Test encoding a JSON object as a buffer.
    """
    assert BufferX.fromJSON({"foo": "bar"}) == b'{"foo": "bar"}'
    assert BufferX.fromJSON({"number": 42}) == b'{"number": 42}'
    assert BufferX.fromJSON([1, 2, 3]) == b'[1, 2, 3]'
    assert BufferX.fromJSON("hello") == b'"hello"'
