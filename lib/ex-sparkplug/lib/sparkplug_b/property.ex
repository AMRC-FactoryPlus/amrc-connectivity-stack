# ACS Sparkplug B
# Sparkplug property values
# Copyright 2026 University of Sheffield

defmodule SparkplugB.Property do
  @moduledoc """
  A Sparkplug property value: a datatype and a native value.

  A property set decodes to a map from key to `t:t/0`, so a metric's
  engineering unit is `metric.properties["engUnit"].value`. Values follow
  the same rules as `SparkplugB.Metric` values; a nested property set is
  another map, and a property set list is a list of maps.
  """

  alias SparkplugB.DataType
  alias SparkplugB.Proto.Org.Eclipse.Tahu.Protobuf.Payload
  alias SparkplugB.Value

  defstruct [:datatype, :value]

  @type t :: %__MODULE__{
          datatype: DataType.t() | non_neg_integer() | nil,
          value: term()
        }

  @doc false
  @spec from_set(Payload.PropertySet.t() | nil) :: %{String.t() => t()}
  def from_set(nil), do: %{}

  def from_set(%Payload.PropertySet{keys: keys, values: values}) do
    keys
    |> Enum.map(&Value.text/1)
    |> Enum.zip(values)
    |> Map.new(fn {key, value} -> {key, from_value(value)} end)
  end

  defp from_value(%Payload.PropertyValue{type: type, is_null: is_null, value: value}) do
    datatype = DataType.from_wire(type)
    value = if is_null, do: nil, else: Value.from_wire(datatype, value)
    %__MODULE__{datatype: datatype, value: value}
  end
end
