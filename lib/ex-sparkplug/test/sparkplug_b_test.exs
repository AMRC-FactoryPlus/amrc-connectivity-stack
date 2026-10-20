# ACS Sparkplug B
# Tests for decoding payloads to native values
# Copyright 2026 University of Sheffield

defmodule SparkplugBTest do
  use ExUnit.Case, async: true

  import SparkplugB.Fixtures

  alias SparkplugB.DecodeError
  alias SparkplugB.Payload
  alias SparkplugB.Property

  @ms 1_000_000

  defp properties(nil), do: %{}

  defp properties(js) do
    Map.new(js, fn {key, %{"type" => type, "value" => value}} ->
      {key, %Property{datatype: datatype(type), value: untag(value)}}
    end)
  end

  # Tahu JS is the decoder prod uses, so its values are the reference.
  # See test/fixtures/README.md.
  describe "fixtures encoded by Tahu JS" do
    for name <- names() do
      test "#{name} decodes to the values Tahu decodes" do
        {bin, expected} = load(unquote(name))

        assert {:ok, %Payload{} = payload} = SparkplugB.decode(bin, timestamp_unit: :auto)
        assert payload.seq == untag(expected["seq"])
        assert length(payload.metrics) == length(expected["metrics"])

        for {metric, js} <- Enum.zip(payload.metrics, expected["metrics"]) do
          assert metric.name == js["name"]
          assert metric.alias == untag(js["alias"])
          assert metric.datatype == datatype(js["type"])
          assert metric.value == untag(js["value"])
          assert metric.is_transient == (js["isTransient"] == true)
          assert metric.properties == properties(js["properties"])
        end
      end
    end
  end

  describe "timestamps" do
    test ":auto reads ACS nanoseconds and older milliseconds" do
      {bin, _} = load("ddata_timestamps")
      {:ok, payload} = SparkplugB.decode(bin, timestamp_unit: :auto)

      assert payload.timestamp == 1_760_000_000_123_456_789

      assert Enum.map(payload.metrics, & &1.timestamp) == [
               1_760_000_000_123 * @ms,
               1_760_000_000_123_456_789,
               nil,
               999_999_999_999_999 * @ms,
               1_000_000_000_000_000
             ]
    end

    test ":ms, the default, follows the spec" do
      {bin, _} = load("nbirth")

      assert {:ok, %Payload{timestamp: timestamp}} = SparkplugB.decode(bin)
      assert timestamp == 1_760_000_000_123 * @ms
    end

    test ":ms misreads ACS nanoseconds, which is why ACS passes :auto" do
      {bin, _} = load("ddata_timestamps")

      assert {:ok, %Payload{timestamp: timestamp}} = SparkplugB.decode(bin)
      assert timestamp == 1_760_000_000_123_456_789 * @ms
    end

    test "an unknown unit is an argument error" do
      assert_raise ArgumentError, fn -> SparkplugB.decode(<<>>, timestamp_unit: :ns) end
    end
  end

  test "a binary that isn't a payload is an error" do
    # Field 4 (uuid) claims 5 bytes but only 1 follows.
    assert {:error, %DecodeError{message: message}} = SparkplugB.decode(<<34, 5, 1>>)
    assert is_binary(message)
  end
end
