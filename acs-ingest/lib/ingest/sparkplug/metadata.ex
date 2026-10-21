# ACS Ingest
# What a Sparkplug birth says about each metric
# Copyright 2026 University of Sheffield

defmodule Ingest.Sparkplug.Metadata do
  @moduledoc """
  What a birth says about one of its metrics, kept to make sense of the
  metric's later DATA: its name, alias, datatype, unit (the `engUnit`
  property) and transient flag, and the Factory+ instances and schemas
  it belongs to.

  ## Factory+ instances and schemas

  These come from a Factory+ payload, whose `uuid` is
  `11ad7b32-1d32-4c4a-b0c9-fa049208939a`; for others the tops are
  `nil` and the chains empty. They are worked out as the JS historian
  does, quirks included, so the Elixir historian writes the same tags:

    * Every birth metric whose name ends in `Schema_UUID` (so
      `MySchema_UUID` counts) gives the schema at its path, the name
      without its last segment. An empty path gives the top-level
      schema; a later one replaces an earlier one. `Instance_UUID`
      works the same way.
    * The paths are kept in the order of a JS object's keys: paths that
      look like array indexes (`"5"`) first, in numeric order, then the
      rest in the order they were first seen.
    * `full` is the value for every path that is a substring of the
      metric's name, so `Phases/1` also matches `Phases/10/Voltage`.
    * `bottom` is the value for the last such path that has a `/` in
      it, or `""`. The JS compares each path's depth with the depth of
      the previous value, a UUID, rather than of the previous path, so
      the order of the birth decides, not the depth.

  A birth metric with no name can't be resolved this way, and is left
  out.
  """

  alias SparkplugB.Metric
  alias SparkplugB.Property

  @factory_plus "11ad7b32-1d32-4c4a-b0c9-fa049208939a"

  @enforce_keys [:name, :alias, :datatype, :unit, :transient, :instance, :schema]
  defstruct @enforce_keys

  @typedoc "The top-level UUID, the bottom one, and every one that applies."
  @type chain :: %{top: term(), bottom: term(), full: [term()]}

  @type t :: %__MODULE__{
          name: String.t(),
          alias: non_neg_integer() | nil,
          datatype: SparkplugB.DataType.t() | non_neg_integer() | nil,
          unit: term(),
          transient: boolean(),
          instance: chain(),
          schema: chain()
        }

  @type index :: %{by_alias: %{non_neg_integer() => t()}, by_name: %{String.t() => t()}}

  @doc """
  The metadata for each named metric of a birth, paired with the metric,
  in the birth's order, and how many metrics had no name. `uuid` is the
  payload's.
  """
  @spec from_birth(String.t() | nil, [Metric.t()]) :: {[{Metric.t(), t()}], non_neg_integer()}
  def from_birth(uuid, metrics) do
    {named, nameless} = Enum.split_with(metrics, &is_binary(&1.name))
    {instance_top, instances} = uuids(uuid, named, "Instance_UUID")
    {schema_top, schemas} = uuids(uuid, named, "Schema_UUID")

    pairs =
      for metric <- named do
        {metric,
         %__MODULE__{
           name: metric.name,
           alias: metric.alias,
           datatype: metric.datatype,
           unit: unit(metric),
           transient: metric.is_transient,
           instance: chain(metric.name, instance_top, instances),
           schema: chain(metric.name, schema_top, schemas)
         }}
      end

    {pairs, length(nameless)}
  end

  @doc """
  Index a birth's metadata for `lookup/2`, by alias and by name. As in
  `SparkplugB.Host`, a later metric replaces an earlier one with the
  same alias or name.
  """
  @spec index([{Metric.t(), t()}]) :: index()
  def index(pairs) do
    %{
      by_alias: for({_metric, %{alias: a} = meta} <- pairs, a != nil, into: %{}, do: {a, meta}),
      by_name: for({_metric, meta} <- pairs, into: %{}, do: {meta.name, meta})
    }
  end

  @doc """
  The metadata for a DATA metric that `SparkplugB.Host` resolved: by
  alias if it has one, otherwise by name, as Host resolves it. `nil` for
  a metric whose birth metric had no name.
  """
  @spec lookup(index(), Metric.t()) :: t() | nil
  def lookup(index, %Metric{alias: a}) when a != nil, do: Map.get(index.by_alias, a)
  def lookup(index, %Metric{name: name}), do: Map.get(index.by_name, name)

  defp uuids(@factory_plus, metrics, suffix) do
    {top, entries} =
      Enum.reduce(metrics, {nil, []}, fn %Metric{name: name, value: value}, {top, entries} ->
        cond do
          not String.ends_with?(name, suffix) -> {top, entries}
          parent(name) == "" -> {value, entries}
          true -> {top, List.keystore(entries, parent(name), 0, {parent(name), value})}
        end
      end)

    {top, js_key_order(entries)}
  end

  defp uuids(_uuid, _metrics, _suffix), do: {nil, []}

  # The name without its last segment.
  defp parent(name), do: name |> String.split("/") |> Enum.drop(-1) |> Enum.join("/")

  defp js_key_order(entries) do
    {indexes, others} = Enum.split_with(entries, fn {path, _value} -> array_index?(path) end)
    Enum.sort_by(indexes, fn {path, _value} -> String.to_integer(path) end) ++ others
  end

  # A canonical integer string from 0 to 2^32 - 2.
  defp array_index?(key) do
    case Integer.parse(key) do
      {n, ""} when n >= 0 and n <= 4_294_967_294 -> Integer.to_string(n) == key
      _ -> false
    end
  end

  defp chain(name, top, entries) do
    matching = Enum.filter(entries, fn {path, _value} -> String.contains?(name, path) end)

    bottom =
      Enum.reduce(matching, "", fn {path, value}, bottom ->
        if depth(path) > depth(bottom), do: value, else: bottom
      end)

    %{top: top, bottom: bottom, full: Enum.map(matching, fn {_path, value} -> value end)}
  end

  # The JS splits the previous value too. A value that isn't a string
  # would crash it there; count it as one level, like a UUID.
  defp depth(string) when is_binary(string), do: length(String.split(string, "/"))
  defp depth(_value), do: 1

  defp unit(%Metric{properties: %{"engUnit" => %Property{value: value}}}), do: value
  defp unit(_metric), do: nil
end
