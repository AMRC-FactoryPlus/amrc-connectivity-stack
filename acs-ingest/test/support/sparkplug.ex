# ACS Ingest
# Sparkplug payloads for tests
# Copyright 2026 University of Sheffield

defmodule Ingest.Test.Sparkplug do
  @moduledoc false

  alias SparkplugB.Proto.Org.Eclipse.Tahu.Protobuf.Payload

  @factory_plus "11ad7b32-1d32-4c4a-b0c9-fa049208939a"

  @types %{
    int8: 1,
    int16: 2,
    int32: 3,
    int64: 4,
    uint8: 5,
    uint16: 6,
    uint32: 7,
    uint64: 8,
    float: 9,
    double: 10,
    boolean: 11,
    string: 12,
    date_time: 13,
    text: 14,
    uuid: 15,
    data_set: 16,
    bytes: 17,
    file: 18,
    template: 19,
    property_set: 20,
    property_set_list: 21,
    int8_array: 22
  }

  def factory_plus, do: @factory_plus

  # An encoded payload. Each metric is a keyword list of `:name`,
  # `:alias`, `:type` (an atom), `:value`, `:timestamp`, `:transient`
  # and `:unit`; `:raw` gives the protobuf value as `{field, value}`,
  # and `:properties` other properties as `[key: {type, value}]`. The
  # payload's options are `:timestamp`, `:seq` and `:uuid`.
  def payload(metrics, opts \\ []) do
    proto = %Payload{
      timestamp: opts[:timestamp],
      seq: opts[:seq],
      uuid: opts[:uuid],
      metrics: Enum.map(metrics, &metric/1)
    }

    {:ok, iodata, _size} = Protox.encode(proto)
    IO.iodata_to_binary(iodata)
  end

  # A Factory+ payload.
  def fplus_payload(metrics, opts \\ []), do: payload(metrics, [uuid: @factory_plus] ++ opts)

  defp metric(opts) do
    type = opts[:type]

    %Payload.Metric{
      name: opts[:name],
      alias: opts[:alias],
      timestamp: opts[:timestamp],
      datatype: type && Map.fetch!(@types, type),
      is_transient: opts[:transient],
      is_null: Keyword.has_key?(opts, :value) and opts[:value] == nil,
      value: Keyword.get_lazy(opts, :raw, fn -> value(type, opts[:value]) end),
      properties: properties(opts)
    }
  end

  defp value(_type, nil), do: nil

  defp value(type, v) when type in [:int8, :int16, :int32, :uint8, :uint16, :uint32],
    do: {:int_value, Bitwise.band(v, 0xFFFFFFFF)}

  defp value(type, v) when type in [:int64, :uint64, :date_time],
    do: {:long_value, Bitwise.band(v, 0xFFFFFFFFFFFFFFFF)}

  defp value(:float, v), do: {:float_value, v}
  defp value(:double, v), do: {:double_value, v}
  defp value(:boolean, v), do: {:boolean_value, v}
  defp value(type, v) when type in [:string, :text, :uuid], do: {:string_value, v}
  defp value(type, v) when type in [:bytes, :file], do: {:bytes_value, v}

  defp properties(opts) do
    unit = if opts[:unit], do: [engUnit: {:string, opts[:unit]}], else: []

    case unit ++ Keyword.get(opts, :properties, []) do
      [] ->
        nil

      properties ->
        %Payload.PropertySet{
          keys: Enum.map(properties, fn {key, _value} -> Atom.to_string(key) end),
          values:
            Enum.map(properties, fn {_key, {type, value}} ->
              %Payload.PropertyValue{type: Map.fetch!(@types, type), value: value(type, value)}
            end)
        }
    end
  end
end
