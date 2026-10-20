# ACS Sparkplug B
# Wire values to native values
# Copyright 2026 University of Sheffield

defmodule SparkplugB.Value do
  @moduledoc false

  alias SparkplugB.Property

  # Integers may arrive in either field: Tahu JS writes UInt32 to
  # long_value, where the spec has int_value.
  @int_fields [:int_value, :long_value]
  @unsigned [:uint8, :uint16, :uint32, :uint64]
  @strings [:string, :text, :uuid]
  @bytes [:bytes, :file]

  # Turn a raw protobuf oneof value, `{field, value}`, into a native
  # value for a datatype. A value we can't convert (no datatype, a
  # datatype we don't handle yet, or the wrong wire field for the
  # datatype) stays as the raw tuple.
  @spec from_wire(atom() | integer() | nil, {atom(), term()} | nil) :: term()
  def from_wire(_datatype, nil), do: nil

  # Signed integers are two's complement in an unsigned field. Taking
  # the low bits for the type's width handles encoders that use the
  # type's own width as well as those that use the field's.
  def from_wire(:int8, {field, v}) when field in @int_fields, do: signed(v, 8)
  def from_wire(:int16, {field, v}) when field in @int_fields, do: signed(v, 16)
  def from_wire(:int32, {field, v}) when field in @int_fields, do: signed(v, 32)
  def from_wire(:int64, {field, v}) when field in @int_fields, do: signed(v, 64)
  def from_wire(type, {field, v}) when type in @unsigned and field in @int_fields, do: v

  def from_wire(:float, {:float_value, v}), do: v
  def from_wire(:double, {:double_value, v}), do: v
  def from_wire(:boolean, {:boolean_value, v}), do: v
  def from_wire(type, {:string_value, v}) when type in @strings, do: v
  def from_wire(:date_time, {:long_value, v}), do: v
  def from_wire(type, {:bytes_value, v}) when type in @bytes, do: v

  def from_wire(:property_set, {:propertyset_value, set}), do: Property.from_set(set)

  def from_wire(:property_set_list, {:propertysets_value, list}),
    do: Enum.map(list.propertyset, &Property.from_set/1)

  def from_wire(_datatype, raw), do: raw

  defp signed(value, bits) do
    <<n::signed-size(^bits)>> = <<value::size(bits)>>
    n
  end
end
