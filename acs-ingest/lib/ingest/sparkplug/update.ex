# ACS Ingest
# Resolved metrics from one Sparkplug message
# Copyright 2026 University of Sheffield

defmodule Ingest.Sparkplug.Update do
  @moduledoc """
  The metrics of one Sparkplug message, resolved against their birth,
  as an edge node's process hands them to its consumers.

    * `:kind` - `:birth` or `:data`. A birth's values are current data
      too.
    * `:address` - `%{group: ..., node: ..., device: ...}`, where
      `device` is `nil` for the node itself.
    * `:metrics` - `{metric, metadata}` pairs, in the message's order:
      the `SparkplugB.Metric` as decoded, and the
      `Ingest.Sparkplug.Metadata` from its birth. A DATA metric has its
      name, alias and datatype filled in from the birth when it left
      them out, and is transient if it or its birth says so. Its
      datatype is its own when it gave one, which may not be the
      birth's.
    * `:timestamp` - the payload's timestamp, in nanoseconds since the
      Unix epoch, or `nil`.
    * `:received` - when the message arrived, in nanoseconds since the
      Unix epoch.
  """

  alias Ingest.Sparkplug.Metadata
  alias SparkplugB.Metric

  @enforce_keys [:kind, :address, :metrics, :timestamp, :received]
  defstruct @enforce_keys

  @type t :: %__MODULE__{
          kind: :birth | :data,
          address: SparkplugB.Host.address(),
          metrics: [{Metric.t(), Metadata.t()}],
          timestamp: non_neg_integer() | nil,
          received: integer()
        }
end
