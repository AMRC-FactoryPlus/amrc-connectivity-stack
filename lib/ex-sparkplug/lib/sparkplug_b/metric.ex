# ACS Sparkplug B
# Decoded Sparkplug metrics
# Copyright 2026 University of Sheffield

defmodule SparkplugB.Metric do
  @moduledoc """
  A decoded Sparkplug metric.

  `value` is a native Elixir value for the metric's `datatype`:

    * integer types: an integer, negative where the type is signed
    * `:float`, `:double`: a float, or `:nan`, `:infinity` or
      `:"-infinity"`, which the BEAM has no float for
    * `:boolean`: a boolean
    * `:string`, `:text`, `:uuid`: a string
    * `:date_time`: the integer as sent (milliseconds since the Unix
      epoch, per the spec)
    * `:bytes`, `:file`: a binary
    * a null metric: `nil`

  A value that can't be converted stays as the raw protobuf
  `{field, value}` tuple, such as `{:long_value, 42}`. That happens:

    * when the metric has no datatype, which Sparkplug allows in DATA
      messages because the birth gives it. `with_datatype/2` converts
      the value once the datatype is known.
    * for datatypes not converted yet: datasets, templates, arrays and
      extensions.
    * when the wire field doesn't match the datatype.
    * when an integer is out of range for its type, such as an Int8
      sent as 300. Signed types accept two's complement at the type's
      own width, or sign-extended to 32 or 64 bits, so an Int8 -5 may be
      251, 4294967291 or 18446744073709551611.

  `timestamp` is integer nanoseconds since the Unix epoch; see
  `SparkplugB.decode/2`. `properties` is a map from key to
  `SparkplugB.Property`, empty when the metric has none.
  """

  alias SparkplugB.DataType
  alias SparkplugB.Property
  alias SparkplugB.Proto.Org.Eclipse.Tahu.Protobuf.Payload
  alias SparkplugB.Timestamp
  alias SparkplugB.Value

  defstruct name: nil,
            alias: nil,
            timestamp: nil,
            datatype: nil,
            value: nil,
            is_historical: false,
            is_transient: false,
            properties: %{},
            metadata: nil

  @type t :: %__MODULE__{
          name: String.t() | nil,
          alias: non_neg_integer() | nil,
          timestamp: non_neg_integer() | nil,
          datatype: DataType.t() | non_neg_integer() | nil,
          value: term(),
          is_historical: boolean(),
          is_transient: boolean(),
          properties: %{String.t() => Property.t()},
          metadata: map() | nil
        }

  @doc """
  Give a metric its datatype, converting a raw value.

  DATA messages may leave the datatype out, because the birth gave it.
  Once the datatype is known from the birth, this converts the raw value
  as if the datatype had been on the wire. A metric that already has a
  datatype is returned unchanged.
  """
  @spec with_datatype(t(), DataType.t()) :: t()
  def with_datatype(%__MODULE__{datatype: nil, value: value} = metric, datatype) do
    %{metric | datatype: datatype, value: Value.from_wire(datatype, value)}
  end

  def with_datatype(%__MODULE__{} = metric, _datatype), do: metric

  @doc false
  @spec from_proto(Payload.Metric.t(), Timestamp.unit()) :: t()
  def from_proto(%Payload.Metric{} = metric, unit) do
    datatype = DataType.from_wire(metric.datatype)

    %__MODULE__{
      name: metric.name,
      alias: metric.alias,
      timestamp: Timestamp.to_ns(metric.timestamp, unit),
      datatype: datatype,
      value: if(metric.is_null, do: nil, else: Value.from_wire(datatype, metric.value)),
      is_historical: metric.is_historical == true,
      is_transient: metric.is_transient == true,
      properties: Property.from_set(metric.properties),
      metadata: metadata(metric.metadata)
    }
  end

  defp metadata(nil), do: nil

  defp metadata(%Payload.MetaData{} = metadata) do
    metadata
    |> Map.from_struct()
    |> Map.delete(:__uf__)
    |> Map.reject(fn {_key, value} -> is_nil(value) end)
  end
end
