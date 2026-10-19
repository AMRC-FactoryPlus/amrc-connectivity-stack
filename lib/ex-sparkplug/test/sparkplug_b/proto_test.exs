# ACS Sparkplug B
# Smoke tests for the generated protobuf modules
# Copyright 2026 University of Sheffield

defmodule SparkplugB.ProtoTest do
  use ExUnit.Case, async: true

  alias SparkplugB.Proto.Org.Eclipse.Tahu.Protobuf.Payload

  defp round_trip(payload) do
    {:ok, iodata, _size} = Protox.encode(payload)
    Protox.decode(IO.iodata_to_binary(iodata), Payload)
  end

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
