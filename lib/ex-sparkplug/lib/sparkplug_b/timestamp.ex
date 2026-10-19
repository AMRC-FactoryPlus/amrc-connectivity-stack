# ACS Sparkplug B
# Wire timestamps to nanoseconds
# Copyright 2026 University of Sheffield

defmodule SparkplugB.Timestamp do
  @moduledoc false

  # Below this, `:auto` reads a timestamp as milliseconds. As
  # milliseconds it is the year ~33700; as nanoseconds it is about 11.5
  # days after the epoch, so no real timestamp is ambiguous. The same
  # threshold as the JS decoders (lib/js-service-client/lib/sparkplug).
  @ns_threshold 1_000_000_000_000_000
  @ms_to_ns 1_000_000

  @type unit :: :ms | :auto

  @spec to_ns(non_neg_integer() | nil, unit()) :: non_neg_integer() | nil
  def to_ns(nil, _unit), do: nil
  def to_ns(ts, :ms), do: ts * @ms_to_ns
  def to_ns(ts, :auto) when ts < @ns_threshold, do: ts * @ms_to_ns
  def to_ns(ts, :auto), do: ts
end
