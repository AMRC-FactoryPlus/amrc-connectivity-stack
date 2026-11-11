# ACS Ingest
# The ISA-95 hierarchy a Sparkplug birth gives its device
# Copyright 2026 University of Sheffield

defmodule Ingest.Sparkplug.Hierarchy do
  @moduledoc """
  The ISA-95 hierarchy a Factory+ birth gives its device, as the levels
  of its UNS topics, Enterprise first. The UNS ingester's topics are
  made from it.

  It follows the rule the UNS ingester shares with i3X and the admin
  UI, `isa95_segments_from_metrics` in
  `lib/js-service-client/lib/isa95.js`, so that they agree on which
  devices are on the UNS. Keep the two in step.

    * Only a hierarchy at exactly `Device_Information/ISA95_Hierarchy`
      counts, and only if the birth's
      `Device_Information/ISA95_Hierarchy/Schema_UUID` is Hierarchy-v1,
      `84ac3397-f3a2-440a-99e5-5bb9f6a75091`. A hierarchy anywhere
      else is ignored.
    * The levels are the values of its `Enterprise`, `Site`, `Area`,
      `Work Center` and `Work Unit` metrics. A later metric with the
      same name replaces an earlier one.
    * Each value is made a string as JS's `String()` makes it (see
      `Ingest.JS.string/1`), and trimmed as JS trims (see
      `Ingest.JS.trim/1`). A missing or null value is empty.
    * Reading stops at the first empty level, so `Acme`, `""`, `Area1`
      gives `["Acme"]`. A value below an empty level is never read.
    * The device has no hierarchy if its Enterprise is empty, or if a
      level read has `/`, `+`, `#` or U+0000 in it, or is `Edge`, which
      ends the levels in a UNS topic. Such a device is left off the UNS
      rather than published at a shorter path than it asked for.

  One difference from the JS: a value that isn't a string, a number or
  a boolean, which JS would write as `[object Object]`, leaves the
  device off the UNS too.

  A birth that isn't a Factory+ payload has no hierarchy.
  """

  alias Ingest.JS
  alias SparkplugB.Metric

  @factory_plus "11ad7b32-1d32-4c4a-b0c9-fa049208939a"
  @hierarchy_v1 "84ac3397-f3a2-440a-99e5-5bb9f6a75091"
  @path "Device_Information/ISA95_Hierarchy"
  @schema_uuid @path <> "/Schema_UUID"
  @level_names ["Enterprise", "Site", "Area", "Work Center", "Work Unit"]
  @levels Enum.map(@level_names, &{&1, "#{@path}/#{&1}"})

  @typedoc "A device's UNS topic levels, Enterprise first, or why it has none."
  @type t :: {:ok, [String.t(), ...]} | {:error, String.t()}

  @doc """
  The hierarchy of a birth, given the payload's `uuid` and the birth's
  named metrics.
  """
  @spec from_birth(String.t() | nil, [Metric.t()]) :: t()
  def from_birth(@factory_plus, metrics) do
    values = Map.new(metrics, &{&1.name, &1.value})

    if values[@schema_uuid] == @hierarchy_v1,
      do: levels(@levels, values, []),
      else: {:error, "its birth has no ISA-95 hierarchy at #{@path}"}
  end

  def from_birth(_uuid, _metrics), do: {:error, "its birth isn't a Factory+ payload"}

  defp levels([], _values, segments), do: {:ok, Enum.reverse(segments)}

  defp levels([{level, name} | rest], values, segments) do
    case segment(level, values[name]) do
      {:ok, ""} when segments == [] -> {:error, "its ISA-95 Enterprise is missing or empty"}
      {:ok, ""} -> {:ok, Enum.reverse(segments)}
      {:ok, segment} -> levels(rest, values, [segment | segments])
      {:error, _reason} = error -> error
    end
  end

  defp segment(_level, nil), do: {:ok, ""}

  defp segment(level, value) do
    case JS.string(value) do
      {:ok, string} -> string |> JS.trim() |> topic_level(level)
      :error -> {:error, "its ISA-95 #{level}, #{inspect(value)}, isn't a string or a number"}
    end
  end

  defp topic_level("Edge", level),
    do: {:error, ~s(its ISA-95 #{level} is "Edge", which UNS topics reserve)}

  defp topic_level(segment, level) do
    if String.contains?(segment, ["/", "+", "#", <<0>>]),
      do: {:error, "its ISA-95 #{level}, #{inspect(segment)}, has /, +, # or U+0000 in it"},
      else: {:ok, segment}
  end
end
