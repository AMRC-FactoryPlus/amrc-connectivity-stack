# ACS Ingest
# Tests for what a Sparkplug birth says about each metric
# Copyright 2026 University of Sheffield

defmodule Ingest.Sparkplug.MetadataTest do
  use ExUnit.Case, async: true

  import Ingest.Test.Sparkplug

  alias Ingest.Sparkplug.Metadata

  defp birth(metrics, opts \\ []) do
    {:ok, payload} = SparkplugB.decode(payload(metrics, opts))
    Metadata.from_birth(payload.uuid, payload.metrics)
  end

  defp by_name(pairs), do: Map.new(pairs, fn {metric, meta} -> {metric.name, meta} end)

  defp uuid(name, value, alias), do: [name: name, type: :uuid, value: value, alias: alias]

  describe "Factory+ instances and schemas" do
    # The harness's "Factory+ birth" scenario; output.txt has the tags the
    # JS historian wrote from it.
    setup do
      metrics = [
        uuid("Schema_UUID", "s-top", 1),
        uuid("Instance_UUID", "i-top", 2),
        uuid("Phases/Schema_UUID", "s-phases", 3),
        uuid("Phases/1/Schema_UUID", "s-ph1", 4),
        uuid("Phases/1/Instance_UUID", "i-ph1", 5),
        [name: "Phases/1/Voltage", type: :double, value: 230.5, alias: 6, unit: "V"],
        uuid("Phases/10/Schema_UUID", "s-ph10", 7),
        [name: "Phases/10/Voltage", type: :double, value: 231.0, alias: 8, unit: "V"],
        uuid("Axes/1/BaseAxis/Position/Schema_UUID", "s-pos", 9),
        uuid("Axes/1/Schema_UUID", "s-ax1", 10),
        [name: "Axes/1/BaseAxis/Position/Actual", type: :float, value: 1.5, alias: 11],
        [name: "Status", type: :string, value: "ok", alias: 12],
        [name: "Secret", type: :string, value: "x", alias: 13, transient: true]
      ]

      {pairs, 0} = birth(metrics, uuid: factory_plus())
      %{metas: by_name(pairs), pairs: pairs}
    end

    test "keep the birth's order and metrics", %{pairs: pairs} do
      assert Enum.map(pairs, fn {metric, meta} -> {metric.alias, meta.alias} end) ==
               Enum.map(1..13, &{&1, &1})
    end

    test "give every metric the tops", %{metas: metas} do
      for {_name, meta} <- metas do
        assert meta.instance.top == "i-top"
        assert meta.schema.top == "s-top"
      end
    end

    test "match paths as substrings, so Phases/1 matches Phases/10", %{metas: metas} do
      # usesSchemas=s-top:s-phases:s-ph1:s-ph10, bottomLevelSchema=s-ph10,
      # usesInstances=i-top:i-ph1, bottomLevelInstance=i-ph1
      assert metas["Phases/10/Voltage"].schema ==
               %{
                 top: "s-top",
                 bottom: "s-ph10",
                 full: ["s-phases", "s-ph1", "s-ph10"],
                 uses: "s-top:s-phases:s-ph1:s-ph10"
               }

      assert metas["Phases/10/Voltage"].instance ==
               %{top: "i-top", bottom: "i-ph1", full: ["i-ph1"], uses: "i-top:i-ph1"}

      assert metas["Phases/1/Voltage"].schema ==
               %{
                 top: "s-top",
                 bottom: "s-ph1",
                 full: ["s-phases", "s-ph1"],
                 uses: "s-top:s-phases:s-ph1"
               }
    end

    test "take the bottom in birth order, not by depth", %{metas: metas} do
      # bottomLevelSchema=s-ax1, usesSchemas=s-top:s-pos:s-ax1
      assert metas["Axes/1/BaseAxis/Position/Actual"].schema ==
               %{
                 top: "s-top",
                 bottom: "s-ax1",
                 full: ["s-pos", "s-ax1"],
                 uses: "s-top:s-pos:s-ax1"
               }

      assert metas["Axes/1/BaseAxis/Position/Actual"].instance ==
               %{top: "i-top", bottom: "", full: [], uses: "i-top:"}
    end

    test "never take a one-level path as the bottom", %{metas: metas} do
      assert metas["Phases/Schema_UUID"].schema ==
               %{top: "s-top", bottom: "", full: ["s-phases"], uses: "s-top:s-phases"}

      assert metas["Status"].schema == %{top: "s-top", bottom: "", full: [], uses: "s-top:"}
    end

    test "carry the datatype, unit and transient flag", %{metas: metas} do
      assert %Metadata{datatype: :double, unit: "V", transient: false} =
               metas["Phases/1/Voltage"]

      assert %Metadata{datatype: :string, unit: nil, transient: true} = metas["Secret"]
    end
  end

  test "the bottom compares a path's depth with the previous value's, as the JS does" do
    # A value with slashes in it is as deep as a path.
    metrics = [
      uuid("A/B/Schema_UUID", "v/1/2", 1),
      uuid("A/B/C/Schema_UUID", "s-abc", 2),
      [name: "A/B/C/Value", type: :double, value: 1.0, alias: 3]
    ]

    {pairs, 0} = birth(metrics, uuid: factory_plus())
    assert by_name(pairs)["A/B/C/Value"].schema.bottom == "v/1/2"
  end

  test "a payload that isn't Factory+ has no instances or schemas" do
    metrics = [uuid("Schema_UUID", "s-top", 1), [name: "A/B/Value", type: :double, value: 1.0]]
    {pairs, 0} = birth(metrics)

    for {_metric, meta} <- pairs do
      assert meta.schema == %{top: nil, bottom: "", full: [], uses: "null:"}
      assert meta.instance == %{top: nil, bottom: "", full: [], uses: "null:"}
    end
  end

  test "names ending in Schema_UUID count, and a later top replaces an earlier one" do
    metrics = [
      uuid("Schema_UUID", "s-1", 1),
      uuid("A/MySchema_UUID", "s-a", 2),
      uuid("MySchema_UUID", "s-2", 3),
      [name: "A/Value", type: :double, value: 1.0, alias: 4]
    ]

    {pairs, 0} = birth(metrics, uuid: factory_plus())

    assert by_name(pairs)["A/Value"].schema == %{
             top: "s-2",
             bottom: "",
             full: ["s-a"],
             uses: "s-2:s-a"
           }
  end

  test "uses joins nulls as the JS does, and is nil for a UUID that isn't a string" do
    metrics = [
      uuid("Schema_UUID", "s-top", 1),
      uuid("A/Schema_UUID", nil, 2),
      [name: "Instance_UUID", type: :int32, value: 5, alias: 3],
      [name: "A/V", type: :double, value: 1.0, alias: 4]
    ]

    {pairs, 0} = birth(metrics, uuid: factory_plus())
    meta = by_name(pairs)["A/V"]
    assert meta.schema.uses == "s-top:"
    assert meta.instance == %{top: 5, bottom: "", full: [], uses: nil}
  end

  test "paths are in JS object key order" do
    # Array-index paths come first, in numeric order; a path seen again
    # keeps its place.
    metrics = [
      uuid("b/Schema_UUID", "s-b", 1),
      uuid("10/Schema_UUID", "s-10", 2),
      uuid("2/Schema_UUID", "s-2", 3),
      uuid("a/Schema_UUID", "s-a", 4),
      uuid("b/Schema_UUID", "s-b2", 5),
      uuid("02/Schema_UUID", "s-02", 6),
      [name: "b/10/02/a/Value", type: :double, value: 1.0, alias: 7]
    ]

    {pairs, 0} = birth(metrics, uuid: factory_plus())

    assert by_name(pairs)["b/10/02/a/Value"].schema.full ==
             ["s-2", "s-10", "s-b2", "s-a", "s-02"]
  end

  test "metrics with no name are left out and counted" do
    metrics = [
      [alias: 1, type: :double, value: 1.0],
      [name: "A", alias: 2, type: :double, value: 2.0]
    ]

    assert {[{%{name: "A"}, %Metadata{name: "A"}}], 1} = birth(metrics, uuid: factory_plus())
  end

  describe "lookup/2" do
    test "finds a metric by alias, or by name when it has none" do
      metrics = [
        [name: "A", alias: 1, type: :double, value: 1.0],
        [name: "B", type: :double, value: 2.0]
      ]

      index = metrics |> birth() |> elem(0) |> Metadata.index()

      assert %Metadata{name: "A"} = Metadata.lookup(index, %SparkplugB.Metric{alias: 1})
      assert %Metadata{name: "B"} = Metadata.lookup(index, %SparkplugB.Metric{name: "B"})
      assert Metadata.lookup(index, %SparkplugB.Metric{alias: 2, name: "B"}) == nil
      assert Metadata.lookup(index, %SparkplugB.Metric{name: "C"}) == nil
    end

    test "uses the later of two metrics with the same alias, as Host does" do
      metrics = [
        [name: "A", alias: 1, type: :double, value: 1.0],
        [name: "B", alias: 1, type: :double, value: 2.0]
      ]

      index = metrics |> birth() |> elem(0) |> Metadata.index()
      assert %Metadata{name: "B"} = Metadata.lookup(index, %SparkplugB.Metric{alias: 1})
    end
  end
end
