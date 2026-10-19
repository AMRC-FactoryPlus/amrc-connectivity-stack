# ACS Sparkplug B
# Decoded Sparkplug payloads
# Copyright 2026 University of Sheffield

defmodule SparkplugB.Payload do
  @moduledoc """
  A decoded Sparkplug B payload.

  `timestamp` is integer nanoseconds since the Unix epoch; see
  `SparkplugB.decode/2`. `metrics` are `SparkplugB.Metric` structs in
  wire order.
  """

  alias SparkplugB.Metric
  alias SparkplugB.Proto.Org.Eclipse.Tahu.Protobuf.Payload, as: Proto
  alias SparkplugB.Timestamp

  defstruct timestamp: nil, seq: nil, uuid: nil, body: nil, metrics: []

  @type t :: %__MODULE__{
          timestamp: non_neg_integer() | nil,
          seq: non_neg_integer() | nil,
          uuid: String.t() | nil,
          body: binary() | nil,
          metrics: [Metric.t()]
        }

  @doc false
  @spec from_proto(Proto.t(), Timestamp.unit()) :: t()
  def from_proto(%Proto{} = payload, unit) do
    %__MODULE__{
      timestamp: Timestamp.to_ns(payload.timestamp, unit),
      seq: payload.seq,
      uuid: payload.uuid,
      body: payload.body,
      metrics: Enum.map(payload.metrics, &Metric.from_proto(&1, unit))
    }
  end
end
