# ACS Sparkplug B
# Tests for the generated protobuf modules
# Copyright 2026 University of Sheffield

defmodule SparkplugB.ProtoTest do
  use ExUnit.Case, async: true

  import SparkplugB.Fixtures

  alias SparkplugB.Proto.Org.Eclipse.Tahu.Protobuf.DataType
  alias SparkplugB.Proto.Org.Eclipse.Tahu.Protobuf.Payload

  defp round_trip(payload) do
    {:ok, iodata, _size} = Protox.encode(payload)
    Protox.decode(IO.iodata_to_binary(iodata), Payload)
  end

  describe "encode and decode" do
    test "a payload survives an encode and decode" do
      payload = %Payload{
        timestamp: 1_760_000_000_123,
        seq: 3,
        metrics: [
          %Payload.Metric{
            name: "Phases/1/Voltage",
            alias: 7,
            datatype: 10,
            value: {:double_value, 230.5}
          }
        ]
      }

      assert {:ok, ^payload} = round_trip(payload)
    end

    test "a nanosecond timestamp keeps full uint64 precision" do
      # ACS edge agents put nanoseconds in the uint64 timestamp field.
      # This value is above 2^53, where a JS number loses precision.
      ns = 1_760_000_000_123_456_789
      payload = %Payload{metrics: [%Payload.Metric{alias: 1, timestamp: ns}]}

      assert {:ok, %Payload{metrics: [%Payload.Metric{timestamp: ^ns}]}} =
               round_trip(payload)
    end

    test "the largest uint64 value survives" do
      max = 18_446_744_073_709_551_615
      payload = %Payload{metrics: [%Payload.Metric{alias: 1, value: {:long_value, max}}]}

      assert {:ok, %Payload{metrics: [%Payload.Metric{value: {:long_value, ^max}}]}} =
               round_trip(payload)
    end
  end

  # Fixtures encoded by Tahu's JS library, as ACS edge agents encode,
  # with Tahu's own decode of the same bytes alongside. See
  # test/fixtures/README.md. Here we check the protobuf layer agrees
  # with Tahu; sparkplug_b_test.exs compares the native values.
  describe "fixtures encoded by Tahu JS" do
    for name <- names() do
      test "#{name} has the structure Tahu decodes" do
        {bin, expected} = load(unquote(name))

        assert {:ok, %Payload{} = payload} = Protox.decode(bin, Payload)
        assert payload.timestamp == untag(expected["timestamp"])
        assert payload.seq == untag(expected["seq"])
        assert length(payload.metrics) == length(expected["metrics"])

        for {metric, js} <- Enum.zip(payload.metrics, expected["metrics"]) do
          assert metric.name == js["name"]
          assert metric.alias == untag(js["alias"])
          assert metric.timestamp == untag(js["timestamp"])
          assert Atom.to_string(DataType.decode(metric.datatype)) == js["type"]
          assert metric.is_transient == js["isTransient"]

          js_props = js["properties"] || %{}
          props = metric.properties || %Payload.PropertySet{}
          assert Enum.sort(props.keys) == Enum.sort(Map.keys(js_props))

          for {key, value} <- Enum.zip(props.keys, props.values) do
            assert Atom.to_string(DataType.decode(value.type)) == js_props[key]["type"]
          end
        end
      end
    end

    test "each datatype uses the wire field Tahu JS writes" do
      {bin, _} = load("ddata_scalars")
      {:ok, payload} = Protox.decode(bin, Payload)

      fields =
        Map.new(payload.metrics, fn %{alias: a, value: {field, _}} -> {a, field} end)

      # UInt32 goes in long_value: that's what Tahu JS does, and what
      # the native layer must accept.
      assert fields == %{
               10 => :int_value,
               11 => :int_value,
               12 => :int_value,
               13 => :int_value,
               14 => :long_value,
               15 => :int_value,
               16 => :int_value,
               17 => :long_value,
               18 => :long_value,
               19 => :float_value,
               20 => :double_value,
               21 => :boolean_value,
               22 => :string_value,
               23 => :string_value,
               24 => :string_value,
               25 => :long_value,
               26 => :bytes_value
             }
    end

    test "signed integers arrive as two's complement" do
      {bin, _} = load("ddata_scalars")
      {:ok, payload} = Protox.decode(bin, Payload)
      values = Map.new(payload.metrics, fn %{alias: a, value: {_, v}} -> {a, v} end)

      # Int8 -5 in a uint32, and Int64 -5000000000 in a uint64. The
      # native layer turns these back into negative integers.
      assert values[10] == 4_294_967_291
      assert values[14] == 18_446_744_068_709_551_616
    end
  end
end
