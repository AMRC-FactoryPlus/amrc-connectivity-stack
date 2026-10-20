# ACS Sparkplug B
# Sparkplug datatypes as atoms
# Copyright 2026 University of Sheffield

defmodule SparkplugB.DataType do
  @moduledoc """
  Sparkplug datatypes as atoms.

  The wire carries a datatype as an integer. `from_wire/1` turns it into
  an atom such as `:double` or `:uint64`. An integer this library doesn't
  know, from a newer version of the spec, stays an integer.
  """

  @datatypes %{
    0 => :unknown,
    1 => :int8,
    2 => :int16,
    3 => :int32,
    4 => :int64,
    5 => :uint8,
    6 => :uint16,
    7 => :uint32,
    8 => :uint64,
    9 => :float,
    10 => :double,
    11 => :boolean,
    12 => :string,
    13 => :date_time,
    14 => :text,
    15 => :uuid,
    16 => :data_set,
    17 => :bytes,
    18 => :file,
    19 => :template,
    20 => :property_set,
    21 => :property_set_list,
    22 => :int8_array,
    23 => :int16_array,
    24 => :int32_array,
    25 => :int64_array,
    26 => :uint8_array,
    27 => :uint16_array,
    28 => :uint32_array,
    29 => :uint64_array,
    30 => :float_array,
    31 => :double_array,
    32 => :boolean_array,
    33 => :string_array,
    34 => :date_time_array
  }

  @type t ::
          :unknown
          | :int8
          | :int16
          | :int32
          | :int64
          | :uint8
          | :uint16
          | :uint32
          | :uint64
          | :float
          | :double
          | :boolean
          | :string
          | :date_time
          | :text
          | :uuid
          | :data_set
          | :bytes
          | :file
          | :template
          | :property_set
          | :property_set_list
          | :int8_array
          | :int16_array
          | :int32_array
          | :int64_array
          | :uint8_array
          | :uint16_array
          | :uint32_array
          | :uint64_array
          | :float_array
          | :double_array
          | :boolean_array
          | :string_array
          | :date_time_array

  @doc """
  The datatype for a wire integer. `nil` (no datatype on the wire) stays
  `nil`, and an unknown integer stays as it is.

      iex> SparkplugB.DataType.from_wire(10)
      :double
      iex> SparkplugB.DataType.from_wire(99)
      99
  """
  @spec from_wire(non_neg_integer() | nil) :: t() | non_neg_integer() | nil
  def from_wire(nil), do: nil
  def from_wire(wire) when is_integer(wire), do: Map.get(@datatypes, wire, wire)
end
