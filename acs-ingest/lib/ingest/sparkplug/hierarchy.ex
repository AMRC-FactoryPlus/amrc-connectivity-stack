# ACS Ingest
# The ISA-95 hierarchy a Sparkplug birth gives its device
# Copyright 2026 University of Sheffield

defmodule Ingest.Sparkplug.Hierarchy do
  @moduledoc """
  The ISA-95 hierarchy a Factory+ birth gives its device: the values of
  its Hierarchy-v1 schema's `Enterprise`, `Site`, `Area`, `Work Center`
  and `Work Unit` metrics. The UNS ingester's topics are made from it.

  It is found as the JS UNS ingester finds it:

    * A birth metric whose name ends in `Schema_UUID` and whose value is
      Hierarchy-v1, `84ac3397-f3a2-440a-99e5-5bb9f6a75091`, gives the
      hierarchy at its path, the name without its last segment. A later
      one replaces an earlier one.
    * The path must contain `Device_Information/ISA95_Hierarchy`, as a
      substring. One that doesn't is ignored, and kept in `misplaced`
      for a warning.
    * Each level is the value of the first metric named
      `<path>/Enterprise`, `<path>/Site`, and so on, or `nil` if there
      is none. The values are as decoded, of any type.

  A birth that isn't a Factory+ payload has no hierarchy.
  """

  alias SparkplugB.Metric

  @factory_plus "11ad7b32-1d32-4c4a-b0c9-fa049208939a"
  @hierarchy_v1 "84ac3397-f3a2-440a-99e5-5bb9f6a75091"
  @expected_path "Device_Information/ISA95_Hierarchy"

  @levels [
    enterprise: "Enterprise",
    site: "Site",
    area: "Area",
    work_center: "Work Center",
    work_unit: "Work Unit"
  ]

  defstruct enterprise: nil, site: nil, area: nil, work_center: nil, work_unit: nil, misplaced: []

  @type t :: %__MODULE__{
          enterprise: term(),
          site: term(),
          area: term(),
          work_center: term(),
          work_unit: term(),
          misplaced: [String.t()]
        }

  @doc """
  The hierarchy of a birth, given the payload's `uuid` and the birth's
  named metrics.
  """
  @spec from_birth(String.t() | nil, [Metric.t()]) :: t()
  def from_birth(@factory_plus, metrics) do
    Enum.reduce(metrics, %__MODULE__{}, fn
      %Metric{name: name, value: @hierarchy_v1}, hierarchy ->
        if String.ends_with?(name, "Schema_UUID"),
          do: at(hierarchy, parent(name), metrics),
          else: hierarchy

      _metric, hierarchy ->
        hierarchy
    end)
  end

  def from_birth(_uuid, _metrics), do: %__MODULE__{}

  @doc "The levels, from the enterprise down, as a keyword list."
  @spec levels(t()) :: keyword()
  def levels(%__MODULE__{} = hierarchy),
    do: for({key, _name} <- @levels, do: {key, Map.fetch!(hierarchy, key)})

  defp at(hierarchy, path, metrics) do
    if String.contains?(path, @expected_path) do
      struct!(
        hierarchy,
        for({key, name} <- @levels, do: {key, value(metrics, path <> "/" <> name)})
      )
    else
      %{hierarchy | misplaced: hierarchy.misplaced ++ [path]}
    end
  end

  defp value(metrics, name) do
    case Enum.find(metrics, &(&1.name == name)) do
      %Metric{value: value} -> value
      nil -> nil
    end
  end

  # The name without its last segment.
  defp parent(name), do: name |> String.split("/") |> Enum.drop(-1) |> Enum.join("/")
end
