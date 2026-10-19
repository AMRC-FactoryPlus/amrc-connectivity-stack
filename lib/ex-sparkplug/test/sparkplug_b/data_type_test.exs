# ACS Sparkplug B
# Tests for Sparkplug datatypes
# Copyright 2026 University of Sheffield

defmodule SparkplugB.DataTypeTest do
  use ExUnit.Case, async: true

  doctest SparkplugB.DataType

  test "every datatype in the protobuf enum has an atom" do
    alias SparkplugB.Proto.Org.Eclipse.Tahu.Protobuf.DataType, as: ProtoDataType

    for {wire, _name} <- ProtoDataType.constants() do
      assert is_atom(SparkplugB.DataType.from_wire(wire))
    end
  end

  test "no datatype on the wire stays nil" do
    assert SparkplugB.DataType.from_wire(nil) == nil
  end
end
