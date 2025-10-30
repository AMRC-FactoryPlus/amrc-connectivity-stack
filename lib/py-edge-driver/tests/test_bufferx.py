# Copyright (c) University of Sheffield AMRC 2025.

import struct
import pytest

import amrc.factoryplus.edge_driver.bufferx as BufferX

def test_from_int8():
    """
    Test encoding a signed integer as an 8-bit value.
    """
    assert BufferX.fromInt8(42) == struct.pack("<b", 42)
    assert BufferX.fromInt8(-42) == struct.pack("<b", -42)
    assert BufferX.fromInt8(42) == struct.pack(">b", 42)

def test_from_uint8():
    """
    Test encoding an unsigned integer as an 8-bit value.
    """
    assert BufferX.fromUInt8(42) == struct.pack("<B", 42)
    assert BufferX.fromUInt8(42) == struct.pack(">B", 42)
    with pytest.raises(struct.error):
        BufferX.fromUInt8(-42)

def test_from_int16():
    """
    Test encoding a signed integer as a 16-bit value.
    """
    assert BufferX.fromInt16LE(42) == struct.pack("<h", 42)
    assert BufferX.fromInt16LE(-42) == struct.pack("<h", -42)
    assert BufferX.fromInt16BE(42) == struct.pack(">h", 42)
    assert BufferX.fromInt16BE(-42) == struct.pack(">h", -42)

def test_from_uint16():
    """
    Test encoding an unsigned integer as a 16-bit value.
    """
    assert BufferX.fromUInt16LE(42) == struct.pack("<H", 42)
    assert BufferX.fromUInt16BE(42) == struct.pack(">H", 42)
    with pytest.raises(struct.error):
        BufferX.fromUInt16LE(-42)
    with pytest.raises(struct.error):
            BufferX.fromUInt16BE(-42)

def test_from_int32():
    """
    Test encoding a signed integer as a 32-bit value.
    """
    assert BufferX.fromInt32LE(42) == struct.pack("<i", 42)
    assert BufferX.fromInt32LE(-42) == struct.pack("<i", -42)
    assert BufferX.fromInt32BE(42) == struct.pack(">i", 42)
    assert BufferX.fromInt32BE(-42) == struct.pack(">i", -42)

def test_from_uint32():
    """
    Test encoding an unsigned integer as a 32-bit value.
    """
    assert BufferX.fromUInt32LE(42) == struct.pack("<I", 42)
    assert BufferX.fromUInt32BE(42) == struct.pack(">I", 42)
    with pytest.raises(struct.error):
        BufferX.fromUInt32LE(-42)
    with pytest.raises(struct.error):
        BufferX.fromUInt32BE(-42)

def test_from_int64():
    """
    Test encoding a signed integer as a 64-bit value.
    """
    assert BufferX.fromBigInt64LE(42) == struct.pack("<q", 42)
    assert BufferX.fromBigInt64LE(-42) == struct.pack("<q", -42)
    assert BufferX.fromBigInt64BE(42) == struct.pack(">q", 42)
    assert BufferX.fromBigInt64BE(-42) == struct.pack(">q", -42)

def test_from_uint64():
    """
    Test encoding an unsigned integer as a 64-bit value.
    """
    assert BufferX.fromBigUInt64LE(42) == struct.pack("<Q", 42)
    assert BufferX.fromBigUInt64BE(42) == struct.pack(">Q", 42)
    with pytest.raises(struct.error):
        BufferX.fromBigUInt64LE(-42)
    with pytest.raises(struct.error):
        BufferX.fromBigUInt64BE(-42)

def test_from_float():
    """
    Test encoding a floating-point number as a 32-bit value.
    """
    assert BufferX.fromFloatLE(42.0) == struct.pack("<f", 42.0)
    assert BufferX.fromFloatLE(-42.0) == struct.pack("<f", -42.0)
    assert BufferX.fromFloatBE(42.0) == struct.pack(">f", 42.0)
    assert BufferX.fromFloatBE(-42.0) == struct.pack(">f", -42.0)

def test_from_double():
    """
    Test encoding a floating-point number as a 64-bit value.
    """
    assert BufferX.fromDoubleLE(42.0) == struct.pack("<d", 42.0)
    assert BufferX.fromDoubleLE(-42.0) == struct.pack("<d", -42.0)
    assert BufferX.fromDoubleBE(42.0) == struct.pack(">d", 42.0)
    assert BufferX.fromDoubleBE(-42.0) == struct.pack(">d", -42.0)

def test_from_json():
    """
    Test encoding a JSON object as a buffer.
    """
    assert BufferX.fromJSON({"foo": "bar"}) == b'{"foo": "bar"}'
