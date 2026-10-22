# ACS Ingest
# Tests for building the UNS payload for one topic
# Copyright 2026 University of Sheffield

defmodule Ingest.UnsPayloadTest do
  use ExUnit.Case, async: true

  alias Ingest.UnsPayload

  # 2026-10-05T12:00:00Z
  @t 1_759_665_600_000_000_000
  @ms 1_000_000

  defp build(samples), do: samples |> UnsPayload.build() |> IO.iodata_to_binary()
  defp json(value), do: value |> UnsPayload.value() |> IO.iodata_to_binary()

  # The tests of the JS buildUnsPayload, ported.
  describe "build/1" do
    test "one sample is the value, with no batch" do
      assert build([{@t, 1}]) == ~s({"timestamp":"2025-10-05T12:00:00.000000000Z","value":1})
    end

    test "the newest sample is the value, whatever order they arrive in" do
      samples = [
        {@t + 1000 * @ms, "b"},
        {@t + 3000 * @ms, "d"},
        {@t, "a"},
        {@t + 2000 * @ms, "c"}
      ]

      assert build(samples) ==
               ~s({"timestamp":"2025-10-05T12:00:03.000000000Z","value":"d","batch":[) <>
                 ~s({"timestamp":"2025-10-05T12:00:00.000000000Z","value":"a"},) <>
                 ~s({"timestamp":"2025-10-05T12:00:01.000000000Z","value":"b"},) <>
                 ~s({"timestamp":"2025-10-05T12:00:02.000000000Z","value":"c"}]})
    end

    test "nanoseconds decide the order within a millisecond" do
      assert build([{@t + 900, "late"}, {@t + 100, "early"}]) ==
               ~s({"timestamp":"2025-10-05T12:00:00.000000900Z","value":"late","batch":[) <>
                 ~s({"timestamp":"2025-10-05T12:00:00.000000100Z","value":"early"}]})
    end

    test "of equal timestamps the last given is the value" do
      assert build([{@t, 1}, {@t, 2}]) ==
               ~s({"timestamp":"2025-10-05T12:00:00.000000000Z","value":2,"batch":[) <>
                 ~s({"timestamp":"2025-10-05T12:00:00.000000000Z","value":1}]})
    end
  end

  describe "iso8601/1" do
    test "keeps nanoseconds" do
      assert UnsPayload.iso8601(1_759_665_600_123_456_789) == "2025-10-05T12:00:00.123456789Z"
      assert UnsPayload.iso8601(0) == "1970-01-01T00:00:00.000000000Z"
    end

    # From the harness: the largest timestamps SparkplugB can give, as
    # nanoseconds and as milliseconds.
    test "writes the years JS writes" do
      assert UnsPayload.iso8601(18_446_744_073_709_551_615) == "2554-07-21T23:34:33.709551615Z"
      assert UnsPayload.iso8601(999_999_999_999_999 * @ms) == "+033658-09-27T01:46:39.999000000Z"
      assert UnsPayload.iso8601(253_402_300_800_000 * @ms) == "+010000-01-01T00:00:00.000000000Z"
      assert UnsPayload.iso8601(253_402_300_799_999 * @ms) == "9999-12-31T23:59:59.999000000Z"
    end
  end

  describe "value/1" do
    # From the harness's DDATA cases, as JS wrote them.
    test "writes floats as JS does" do
      cases = [
        {5.0, "5"},
        {100.0, "100"},
        {230.5, "230.5"},
        {0.10000000149011612, "0.10000000149011612"},
        {0.1 + 0.2, "0.30000000000000004"},
        {-0.0, "0"},
        {1.0e21, "1e+21"},
        {1.0e20, "100000000000000000000"},
        {123_456_789_012_345_680_000.0, "123456789012345680000"},
        {3.0_000_000_054_977_558e38, "3.0000000054977558e+38"},
        {1.5e-7, "1.5e-7"},
        {0.000001, "0.000001"},
        {5.0e-324, "5e-324"},
        {1.7_976_931_348_623_157e308, "1.7976931348623157e+308"},
        {-1.5, "-1.5"},
        {-1.0e-7, "-1e-7"}
      ]

      for {float, expected} <- cases, do: assert(json(float) == expected, inspect(float))
    end

    test "writes NaN and the infinities as null" do
      for v <- [:nan, :infinity, :"-infinity"], do: assert(json(v) == "null")
    end

    test "writes integers exactly" do
      assert json(-5) == "-5"
      assert json(9_223_372_036_854_775_807) == "9223372036854775807"
      assert json(18_446_744_073_709_551_615) == "18446744073709551615"
    end

    test "writes booleans" do
      assert {json(true), json(false)} == {"true", "false"}
    end

    test "escapes strings as JSON.stringify does" do
      assert json(~s(a "q" \\ b\nc)) == ~S("a \"q\" \\ b\nc")

      assert json("q\" b\\ n\n t\t / " <> <<1, 31, 127>> <> " \b\f\r") ==
               ~S("q\" b\\ n\n t\t / \u0001\u001f) <> <<127>> <> ~S( \b\f\r")

      # Nothing else is escaped.
      unicode = "é ✓ 😀 " <> <<0x2028::utf8, 0x2029::utf8>>
      assert json(unicode) == ~s("#{unicode}")
      assert json("") == ~s("")
    end

    test "writes bytes as a Node Buffer" do
      assert json({:bytes, <<104, 105, 255>>}) == ~s({"type":"Buffer","data":[104,105,255]})
      assert json({:bytes, ""}) == ~s({"type":"Buffer","data":[]})
    end
  end
end
