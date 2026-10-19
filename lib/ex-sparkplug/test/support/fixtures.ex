# ACS Sparkplug B
# Test helpers for the Tahu JS fixtures
# Copyright 2026 University of Sheffield

defmodule SparkplugB.Fixtures do
  @moduledoc false

  # The fixtures and how they are made: test/fixtures/README.md.

  alias SparkplugB.Proto.Org.Eclipse.Tahu.Protobuf.DataType, as: ProtoDataType

  @dir Path.expand("../fixtures/payloads", __DIR__)

  def names do
    @dir
    |> Path.join("*.bin")
    |> Path.wildcard()
    |> Enum.map(&Path.basename(&1, ".bin"))
    |> Enum.sort()
  end

  # A fixture's bytes, and Tahu's decode of them.
  def load(name) do
    bin = File.read!(Path.join(@dir, name <> ".bin"))
    json = File.read!(Path.join(@dir, name <> ".json"))
    {bin, JSON.decode!(json)}
  end

  # The generator tags the values JSON can't hold.
  def untag(%{"long" => digits}), do: String.to_integer(digits)
  def untag(%{"bytes" => base64}), do: Base.decode64!(base64)
  def untag(%{"float" => "NaN"}), do: :nan
  def untag(%{"float" => "Infinity"}), do: :infinity
  def untag(%{"float" => "-Infinity"}), do: :"-infinity"
  def untag(other), do: other

  # Our datatype for a Tahu type name, such as "UInt64".
  def datatype(tahu_name) do
    ProtoDataType.constants()
    |> Enum.find_value(fn {wire, name} -> Atom.to_string(name) == tahu_name && wire end)
    |> SparkplugB.DataType.from_wire()
  end
end
