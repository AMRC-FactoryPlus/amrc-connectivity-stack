# ACS Ingest
# Tests for the UNS payload: building it, and reading it
# Copyright 2026 University of Sheffield

defmodule Ingest.UnsPayloadTest do
  use ExUnit.Case, async: true

  alias Ingest.UnsPayload

  doctest UnsPayload

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

  # What the JS UNS historian's JSON.parse made of them, from the
  # harness's uns-historian-output.txt.
  describe "decode/1" do
    test "returns the payload's object, then its batch's" do
      payload =
        ~s({"timestamp":"t3","value":3,"batch":[{"timestamp":"t1","value":1},{"value":2}]})

      assert UnsPayload.decode(payload) ==
               {:ok,
                [
                  %{
                    "timestamp" => "t3",
                    "value" => 3,
                    "batch" => [%{"timestamp" => "t1", "value" => 1}, %{"value" => 2}]
                  },
                  %{"timestamp" => "t1", "value" => 1},
                  %{"value" => 2}
                ]}

      assert UnsPayload.decode(~s({"value":1})) == {:ok, [%{"value" => 1}]}

      assert UnsPayload.decode(~s({"value":1,"batch":null})) ==
               {:ok, [%{"value" => 1, "batch" => nil}]}
    end

    test "reads numbers as JS does, but integers exactly" do
      assert {:ok, [%{"a" => 5, "b" => 1.0, "c" => 1000.0, "d" => 0, "e" => -0.0}]} =
               UnsPayload.decode(~s({"a":5,"b":1.0,"c":1e3,"d":-0,"e":-0.0}))

      assert {:ok, [%{"a" => 18_446_744_073_709_551_615, "b" => -9_223_372_036_854_775_808}]} =
               UnsPayload.decode(~s({"a":18446744073709551615,"b":-9223372036854775808}))

      assert {:ok, [%{"a" => :infinity, "b" => :"-infinity", "c" => +0.0}]} =
               UnsPayload.decode(~s({"a":1e400,"b":-1e400,"c":1e-400}))
    end

    test "keeps the last of duplicate keys, as JS does" do
      assert UnsPayload.decode(~s({"value":1,"value":2,"batch":[{"value":3,"value":4}]})) ==
               {:ok, [%{"value" => 2, "batch" => [%{"value" => 4}]}, %{"value" => 4}]}
    end

    test "replaces invalid UTF-8, as Node's Buffer.toString does" do
      assert UnsPayload.decode(~s({"value":"a) <> <<0xFF, 0xC3>> <> ~s(b"})) ==
               {:ok, [%{"value" => "a��b"}]}
    end

    test "allows whitespace around the object" do
      assert UnsPayload.decode(" \n{\"value\":1}\n ") == {:ok, [%{"value" => 1}]}
    end

    test "refuses what isn't a JSON object, or a batch that isn't a list of objects" do
      for payload <- ["{", "", "﻿{}", ~s({"value":1} x), ~s({"value":"a\\ud800b"})] do
        assert {:error, "its payload isn't valid JSON" <> _} = UnsPayload.decode(payload)
      end

      for payload <- ["null", "5", "[]", ~s("s")] do
        assert UnsPayload.decode(payload) == {:error, "its payload isn't a JSON object"}
      end

      for batch <- [~s("x"), "{}", "5", "false"] do
        assert UnsPayload.decode(~s({"value":1,"batch":#{batch}})) ==
                 {:error, "its batch isn't a list"}
      end

      for batch <- ["[null]", "[5]", "[[]]"] do
        assert UnsPayload.decode(~s({"value":1,"batch":#{batch}})) ==
                 {:error, "its batch has an entry that isn't a JSON object"}
      end
    end
  end

  # The nanoseconds are what the JS UNS historian's parse_iso_ns made of
  # each timestamp, run with TZ=UTC as in a pod.
  describe "parse_timestamp/1" do
    test "keeps nine fractional digits before a Z, as the UNS ingester writes them" do
      cases = [
        {"2026-10-20T21:26:10.123456789Z", 1_792_531_570_123_456_789},
        {"2026-10-20T21:26:10.123Z", 1_792_531_570_123_000_000},
        {"2026-10-20T21:26:10.5Z", 1_792_531_570_500_000_000},
        {"2026-10-20T21:26:10.1239Z", 1_792_531_570_123_900_000},
        {"2026-10-20T21:26:10.123456789123Z", 1_792_531_570_123_456_789},
        {"2026-10-20T21:26:10.000000000000000000001Z", 1_792_531_570_000_000_000},
        {"2026-10-20T00:00:00.000000001Z", 1_792_454_400_000_000_001},
        {"1969-12-31T23:59:59.5Z", -500_000_000},
        {"+002026-10-20T21:26:10.123456789Z", 1_792_531_570_123_456_789},
        {"+010000-01-01T00:00:00.000000000Z", 253_402_300_800_000_000_000},
        {"1600-01-01T00:00:00.000000000Z", -11_676_096_000_000_000_000},
        # JS's regex leaves a time without seconds, and the fraction
        # counts as seconds.
        {"2026-10-20T21:26.5Z", 1_792_531_560_500_000_000},
        {"2026-10-20T24:00:00.5Z", 1_792_540_800_500_000_000}
      ]

      for {timestamp, ns} <- cases,
          do: assert(UnsPayload.parse_timestamp(timestamp) == {:ok, ns}, timestamp)
    end

    test "cuts any other fraction to milliseconds, as JS's Date does" do
      cases = [
        {"2026-10-20T22:26:10.123456+01:00", 1_792_531_570_123_000_000},
        {"2026-10-20T21:26:10.1239+01:00", 1_792_527_970_123_000_000},
        {"2026-10-20T21:26:10.9999+00:00", 1_792_531_570_999_000_000},
        {"2026-10-20T21:26:10.123456789+00:00", 1_792_531_570_123_000_000},
        {"2026-10-20T21:26:10.5+01:00", 1_792_527_970_500_000_000},
        {"2026-10-20T21:26:10.123", 1_792_531_570_123_000_000}
      ]

      for {timestamp, ns} <- cases,
          do: assert(UnsPayload.parse_timestamp(timestamp) == {:ok, ns}, timestamp)
    end

    test "reads ECMAScript's shorter forms and offsets" do
      cases = [
        {"2026-10-20T21:26:10Z", 1_792_531_570_000_000_000},
        {"2026-10-20T21:26Z", 1_792_531_560_000_000_000},
        {"2026-10-20T22:26:10+01:00", 1_792_531_570_000_000_000},
        {"2026-10-20T21:26:10-00:00", 1_792_531_570_000_000_000},
        {"2026-10-20T21:26:10+23:59", 1_792_445_230_000_000_000},
        {"2026-10-20T21:26:10-23:59", 1_792_617_910_000_000_000},
        # Without an offset, UTC, as JS's local time is in a pod.
        {"2026-10-20T21:26:10", 1_792_531_570_000_000_000},
        {"2026-10-20T21:26", 1_792_531_560_000_000_000},
        {"2026-10-20", 1_792_454_400_000_000_000},
        {"2026-10", 1_790_812_800_000_000_000},
        {"2026", 1_767_225_600_000_000_000},
        {"2024-02-29T00:00:00Z", 1_709_164_800_000_000_000},
        {"2026-10-20T24:00:00.000Z", 1_792_540_800_000_000_000},
        {"2026-10-20T24:00Z", 1_792_540_800_000_000_000},
        {"+002026-10-20T21:26:10Z", 1_792_531_570_000_000_000},
        {"0000-01-01T00:00:00Z", -62_167_219_200_000_000_000},
        {"-000001-01-01T00:00:00Z", -62_198_755_200_000_000_000}
      ]

      for {timestamp, ns} <- cases,
          do: assert(UnsPayload.parse_timestamp(timestamp) == {:ok, ns}, timestamp)
    end

    test "refuses what JS's Date can't read" do
      invalid = [
        "",
        "garbage",
        "garbage.5Z",
        "x.5Z",
        "2026-10-20T21:26:10.123Z ",
        " 2026-10-20T21:26:10Z",
        "2026-10-20T24:00:01Z",
        "2026-10-20T24:01Z",
        "2026-10-20T23:60Z",
        "2026-10-20T21:26:60.000Z",
        "2026-09-32T00:00:00Z",
        "2026-13-01T00:00:00Z",
        "2026-00-01T00:00:00Z",
        "2026-10-00T00:00:00Z",
        "-000000-01-01T00:00:00Z",
        "2026-10-20T21:26:10.Z",
        "2026-10-20T21:26:10,5Z",
        "2026-10-20T21:26:10+01",
        "2026-10-20T21:26:10+24:00",
        "99-01-01T00:00:00Z",
        "2026-1-1T00:00:00Z",
        "2026-10-20T1:26:10Z",
        "2026-10-20T21:26:10ZZ",
        "2026-10-20T",
        "20261020T212610Z",
        "2026-10-20T21:26:10.5.123Z",
        "2026-10-20T21:26:10.123+01:00.5Z",
        "2026-10-20T21:26:10.123\n.5Z",
        "2026-10-20T21:26:10.12a3Z"
      ]

      for timestamp <- invalid,
          do: assert(UnsPayload.parse_timestamp(timestamp) == :error, inspect(timestamp))
    end

    # JS's Date falls back to V8's legacy parser for these.
    test "refuses V8's lenient forms, and days a month doesn't have" do
      invalid = [
        "2026-10-20Z",
        "2026Z",
        "2026-10-20T21:26:10.123z",
        "2026-10-20t21:26:10Z",
        "2026-10-20 21:26:10.123Z",
        "2026-10-20T21:26:10+0100",
        ".5Z",
        # JS rolls these over into the next month.
        "2026-09-31T00:00:00.000Z",
        "2026-02-29T00:00:00Z",
        "2026-02-31T00:00:00.000Z"
      ]

      for timestamp <- invalid,
          do: assert(UnsPayload.parse_timestamp(timestamp) == :error, inspect(timestamp))
    end
  end
end
