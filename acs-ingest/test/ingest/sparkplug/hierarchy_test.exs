# ACS Ingest
# Tests for the ISA-95 hierarchy a Sparkplug birth gives its device
# Copyright 2026 University of Sheffield

defmodule Ingest.Sparkplug.HierarchyTest do
  # The cases are those of the shared rule's JS tests: the service
  # client's (lib/js-service-client/test/isa95.test.js) and the JS UNS
  # ingester's (uns-ingester-sparkplug/test/isa95.test.mjs, removed
  # when acs-ingest replaced it).

  use ExUnit.Case, async: true

  alias Ingest.Sparkplug.Hierarchy
  alias SparkplugB.Metric

  @factory_plus "11ad7b32-1d32-4c4a-b0c9-fa049208939a"
  @hierarchy_v1 "84ac3397-f3a2-440a-99e5-5bb9f6a75091"
  @device_information "2dd093e9-1450-44c5-be8c-c0d78e48219b"
  @root "Device_Information/ISA95_Hierarchy"
  @names ["Enterprise", "Site", "Area", "Work Center", "Work Unit"]
  @all ["Acme", "Site1", "Area1", "Line 1", "Cell 1"]
  @none "its birth has no ISA-95 hierarchy at Device_Information/ISA95_Hierarchy"
  @empty "its ISA-95 Enterprise is missing or empty"

  defp metric(name, value), do: %Metric{name: name, value: value}

  # A birth's metrics, with a hierarchy's under a path.
  defp birth(path, levels, schema \\ @hierarchy_v1) do
    top = [metric("Schema_UUID", "top-schema"), metric("Temperature", 21.5)]
    hierarchy = if schema, do: [metric("#{path}/Schema_UUID", schema)], else: []
    values = for {level, value} <- levels, do: metric("#{path}/#{level}", value)
    top ++ hierarchy ++ [metric("#{path}/Instance_UUID", "instance")] ++ values
  end

  defp from_birth(metrics), do: Hierarchy.from_birth(@factory_plus, metrics)

  # The hierarchy at the root path with these values, Enterprise first.
  defp levels(values), do: from_birth(birth(@root, Enum.zip(@names, values)))

  test "a hierarchy at the root path is read, spaced levels and all" do
    assert levels(@all) == {:ok, @all}
  end

  test "values are trimmed and reading stops at the first empty level" do
    assert levels([" Acme ", "Site1", "  ", "Line 1", ""]) == {:ok, ["Acme", "Site1"]}
    assert levels(["Acme", nil, "Area1"]) == {:ok, ["Acme"]}
    assert from_birth(birth(@root, Enterprise: "Acme", Area: "Area1")) == {:ok, ["Acme"]}
    assert levels(["\u00A0Acme\uFEFF", "\tSite1\n"]) == {:ok, ["Acme", "Site1"]}
  end

  test "an empty Enterprise is not on the UNS" do
    assert levels(["   ", "Site1"]) == {:error, @empty}
    assert levels([nil, "Site1"]) == {:error, @empty}
    assert levels([]) == {:error, @empty}
  end

  test "values that are safe in a topic are kept" do
    for value <- ["Work Cell 3", "a.b", "Edge1", "edge", "Ünïcødé"],
        do: assert(levels([value]) == {:ok, [value]})
  end

  test "a topic-unsafe value takes the device off the UNS" do
    for {values, level, value} <- [
          {["Acme", "Site/1"], "Site", "Site/1"},
          {["Acme+", "Site1"], "Enterprise", "Acme+"},
          {["Acme", "Site1", "a#b"], "Area", "a#b"},
          {["Acme", "Site1", "Area1", "a\0b"], "Work Center", "a\0b"}
        ] do
      assert levels(values) ==
               {:error, "its ISA-95 #{level}, #{inspect(value)}, has /, +, # or U+0000 in it"}
    end

    assert levels(["Acme", "Site1", " Edge "]) ==
             {:error, ~s(its ISA-95 Area is "Edge", which UNS topics reserve)}
  end

  test "an unsafe value below an empty level is never read" do
    assert levels(["Acme", "", "a#b"]) == {:ok, ["Acme"]}
  end

  test "a nested hierarchy is not on the UNS" do
    for path <- [
          "Device_Information/Base_Device_Information/ISA95_Hierarchy",
          "Base_Robot/Device_Information/ISA95_Hierarchy",
          "ISA95_Hierarchy"
        ] do
      assert from_birth(birth(path, Enterprise: "Acme", Site: "Site1")) == {:error, @none}
    end
  end

  test "a nested copy beside the root one does not change it" do
    metrics =
      birth(@root, Enterprise: "Acme", Site: "Site1") ++
        birth("Safety/Device_Information/ISA95_Hierarchy", Enterprise: "Other")

    assert from_birth(metrics) == {:ok, ["Acme", "Site1"]}
  end

  test "the root hierarchy needs the Hierarchy-v1 schema" do
    assert from_birth(birth(@root, [Enterprise: "Acme"], nil)) == {:error, @none}

    assert from_birth(birth(@root, [Enterprise: "Acme"], @device_information)) == {:error, @none}
    assert from_birth([]) == {:error, @none}
  end

  test "the unspaced spellings are not levels" do
    levels = [Enterprise: "Acme", Site: "S", Area: "A", WorkCenter: "Wrong", WorkUnit: "Wrong"]
    assert from_birth(birth(@root, levels)) == {:ok, ["Acme", "S", "A"]}
  end

  test "a later metric with the same name replaces an earlier one" do
    metrics = birth(@root, Enterprise: "First") ++ [metric("#{@root}/Enterprise", "Second")]
    assert from_birth(metrics) == {:ok, ["Second"]}
  end

  test "numbers and booleans are written as JS writes them" do
    assert levels(["Acme", 5, 1.5, true]) == {:ok, ["Acme", "5", "1.5", "true"]}
    assert levels([0]) == {:ok, ["0"]}
  end

  # JS: String() makes a DataSet, say, "[object Object]", which is safe
  # in a topic, so the JS publishes the device under that level.
  test "a value JS can't write as text takes the device off the UNS" do
    assert levels(["Acme", {:int_value, 5}]) ==
             {:error, "its ISA-95 Site, {:int_value, 5}, isn't a string or a number"}
  end

  test "a payload that isn't Factory+'s has none" do
    for uuid <- [nil, "11111111-1111-4111-8111-111111111111"] do
      assert Hierarchy.from_birth(uuid, birth(@root, Enterprise: "Acme")) ==
               {:error, "its birth isn't a Factory+ payload"}
    end
  end
end
