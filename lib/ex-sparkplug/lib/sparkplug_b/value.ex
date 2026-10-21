# ACS Sparkplug B
# Wire values to native values
# Copyright 2026 University of Sheffield

defmodule SparkplugB.Value do
  @moduledoc false

  import Bitwise

  alias SparkplugB.Property

  # Integers may arrive in either field: Tahu JS writes UInt32 to
  # long_value, where the spec has int_value.
  @int_fields [:int_value, :long_value]
  @strings [:string, :text, :uuid]
  @bytes [:bytes, :file]

  # Turn a raw protobuf oneof value, `{field, value}`, into a native
  # value for a datatype. A value we can't convert (no datatype, a
  # datatype we don't handle yet, the wrong wire field for the datatype,
  # or an integer out of range for its type) stays as the raw tuple.
  @spec from_wire(atom() | integer() | nil, {atom(), term()} | nil) :: term()
  def from_wire(_datatype, nil), do: nil

  def from_wire(:int8, {field, v} = raw) when field in @int_fields, do: signed(raw, v, 8)
  def from_wire(:int16, {field, v} = raw) when field in @int_fields, do: signed(raw, v, 16)
  def from_wire(:int32, {field, v} = raw) when field in @int_fields, do: signed(raw, v, 32)
  def from_wire(:int64, {field, v} = raw) when field in @int_fields, do: signed(raw, v, 64)
  def from_wire(:uint8, {field, v} = raw) when field in @int_fields, do: unsigned(raw, v, 8)
  def from_wire(:uint16, {field, v} = raw) when field in @int_fields, do: unsigned(raw, v, 16)
  def from_wire(:uint32, {field, v} = raw) when field in @int_fields, do: unsigned(raw, v, 32)
  def from_wire(:uint64, {field, v} = raw) when field in @int_fields, do: unsigned(raw, v, 64)

  def from_wire(:float, {:float_value, v}), do: v
  def from_wire(:double, {:double_value, v}), do: v
  def from_wire(:boolean, {:boolean_value, v}), do: v
  def from_wire(type, {:string_value, v}) when type in @strings, do: text(v)
  def from_wire(:date_time, {:long_value, v}), do: v
  def from_wire(type, {:bytes_value, v}) when type in @bytes, do: v

  def from_wire(:property_set, {:propertyset_value, set}), do: Property.from_set(set)

  def from_wire(:property_set_list, {:propertysets_value, list}),
    do: Enum.map(list.propertyset, &Property.from_set/1)

  def from_wire(_datatype, raw), do: raw

  # The protobuf code decodes `string` fields as bytes (see the README),
  # so a payload with invalid UTF-8 in one still decodes. Here invalid
  # sequences become U+FFFD, one for each maximal invalid subsequence, as
  # Node decodes them for Tahu JS.
  @spec text(binary() | nil) :: String.t() | nil
  def text(nil), do: nil
  def text(bytes), do: String.replace_invalid(bytes)

  # Signed integers are two's complement in an unsigned field. Encoders
  # use the type's own width (Int8 -5 as 251), or sign-extend to the
  # field's 32 bits or to 64 (Tahu JS sends Int8 -5 as 4294967291).
  # Anything else, such as an Int8 sent as 300, doesn't fit the type.
  defp signed(raw, v, bits) do
    half = 1 <<< (bits - 1)

    cond do
      v < half -> v
      v < 2 * half -> v - 2 * half
      v >= (1 <<< 32) - half and v < 1 <<< 32 -> v - (1 <<< 32)
      v >= (1 <<< 64) - half and v < 1 <<< 64 -> v - (1 <<< 64)
      true -> raw
    end
  end

  defp unsigned(_raw, v, bits) when v < 1 <<< bits, do: v
  defp unsigned(raw, _v, _bits), do: raw
end
