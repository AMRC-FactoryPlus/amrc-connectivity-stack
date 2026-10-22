# ACS Ingest
# Tests for the points the UNS historian writes
# Copyright 2026 University of Sheffield

defmodule Ingest.UnsHistorianTest do
  # The expected lines are the JS UNS historian's, from the harness's
  # uns-historian-output.txt (see the design doc's UNS historian
  # section), apart from the differences the design doc agrees. A
  # comment marks each one. Floats are written as Ingest.LineProtocol
  # writes them, `1.0` where the JS wrote `1`; InfluxDB reads the same
  # value.

  use ExUnit.Case, async: true

  import ExUnit.CaptureLog

  alias Ingest.UnsHistorian

  @moduletag :capture_log

  @received 1_800_000_000_000_000_000
  @dev "UNS/v1/AMRC/F2050/Shop/Cell 1/Robot/Edge/D1"
  @t1 "2026-10-20T21:26:10.001000000Z"
  @t2 "2026-10-20T21:26:10.002000000Z"
  @t3 "2026-10-20T21:26:10.003000000Z"
  @ns1 1_792_531_570_001_000_000

  # The tags for @dev with props/1's properties.
  @tags "area=Shop,enterprise=AMRC,path=D1,site=F2050,topLevelInstance=i-top," <>
          "topLevelSchema=s-top,unit=V,usesInstances=i-top:,usesSchemas=s-top:," <>
          "workCenter=Cell\\ 1,workUnit=Robot"

  # The user properties the UNS ingester sends, for a Double in V at the
  # device's top level, in its order. `changes` replace a property's
  # value, or with nil remove it; new ones go at the end.
  defp props(changes \\ []) do
    base = [
      {"InstanceUUID", "i-top"},
      {"SchemaUUID", "s-top"},
      {"Transient", "false"},
      {"Unit", "V"},
      {"Type", "Double"},
      {"InstanceUUIDPath", "i-top:"},
      {"SchemaUUIDPath", "s-top:"}
    ]

    changed =
      for {key, value} <- base,
          value = Keyword.get(changes, String.to_atom(key), value),
          do: {key, value}

    new =
      for {key, value} <- changes,
          not List.keymember?(base, Atom.to_string(key), 0),
          do: {Atom.to_string(key), value}

    Enum.reject(changed ++ new, fn {_key, value} -> is_nil(value) end)
  end

  defp points(topic, payload, props) do
    topic
    |> UnsHistorian.points(payload, %{"User-Property": props}, @received)
    |> Enum.map(&IO.iodata_to_binary/1)
  end

  defp json(value, timestamp \\ @t1), do: ~s({"timestamp":"#{timestamp}","value":#{value}})

  # One sample at @t1 under @dev, with props/1's properties changed.
  defp point(value, changes), do: points(@dev <> "/X", json(value), props(changes))

  defp line(measurement, field, ns \\ @ns1),
    do: "#{measurement},#{@tags} value=#{field} #{ns}\n"

  describe "messages as the UNS ingester publishes them" do
    test "a Double" do
      assert points(@dev <> "/Phases/1/Voltage", json(230.5), props()) == [
               "Voltage:d,area=Shop,enterprise=AMRC,path=D1/Phases/1,site=F2050," <>
                 "topLevelInstance=i-top,topLevelSchema=s-top,unit=V,usesInstances=i-top:," <>
                 "usesSchemas=s-top:,workCenter=Cell\\ 1,workUnit=Robot value=230.5 #{@ns1}\n"
             ]
    end

    test "the bottom of a chain is its last UUID, if it has two or more" do
      tags = fn instances, schemas ->
        [line] = point(1.5, InstanceUUIDPath: instances, SchemaUUIDPath: schemas)
        [_measurement | tags] = line |> String.split(" ") |> hd() |> String.split(",")
        Enum.reject(tags, &String.starts_with?(&1, ~w(area enterprise path site unit work)))
      end

      # As in the JS: a chain of one has no bottom.
      assert tags.("i-top:i-a", "s-top:s-a") == [
               "topLevelInstance=i-top",
               "topLevelSchema=s-top",
               "usesInstances=i-top:i-a",
               "usesSchemas=s-top:s-a"
             ]

      assert tags.("i-top:i-a:i-b", "s-top:s-a:s-b") == [
               "bottomLevelInstance=i-b",
               "bottomLevelSchema=s-b",
               "topLevelInstance=i-top",
               "topLevelSchema=s-top",
               "usesInstances=i-top:i-a:i-b",
               "usesSchemas=s-top:s-a:s-b"
             ]

      assert tags.("i-top:i-a:i-b:i-c", "s-top") == [
               "bottomLevelInstance=i-c",
               "topLevelInstance=i-top",
               "topLevelSchema=s-top",
               "usesInstances=i-top:i-a:i-b:i-c",
               "usesSchemas=s-top:"
             ]
    end

    test "a batch is written after the payload's sample" do
      payload =
        ~s({"timestamp":"#{@t3}","value":3,"batch":[) <>
          ~s({"timestamp":"#{@t1}","value":1},{"timestamp":"#{@t2}","value":2}]})

      assert points(@dev <> "/X", payload, props()) == [
               line("X:d", "3.0", @ns1 + 2_000_000),
               line("X:d", "1.0", @ns1),
               line("X:d", "2.0", @ns1 + 1_000_000)
             ]

      # So of equal timestamps, InfluxDB keeps the batch's.
      payload = ~s({"timestamp":"#{@t2}","value":2,"batch":[{"timestamp":"#{@t2}","value":1}]})

      assert points(@dev <> "/X", payload, props()) == [
               line("X:d", "2.0", @ns1 + 1_000_000),
               line("X:d", "1.0", @ns1 + 1_000_000)
             ]
    end

    test "simulated data is marked when Simulated is exactly \"true\"" do
      marked = "X:d,area=Shop,enterprise=AMRC,path=D1,"
      rest = "site=F2050,topLevelInstance=i-top,topLevelSchema=s-top,unit=V,usesInstances=i-top:"

      assert [^marked <> "run_id=run-7,simulated=true," <> ^rest <> _] =
               point(1.5, Simulated: "true", RunId: "run-7")

      assert [^marked <> "simulated=true," <> ^rest <> _] = point(1.5, Simulated: "true")

      assert [^marked <> "simulated=true," <> ^rest <> _] =
               point(1.5, Simulated: "true", RunId: "")

      assert point(1.5, Simulated: "false", RunId: "run-7") == [line("X:d", 1.5)]
      assert point(1.5, Simulated: "TRUE") == [line("X:d", 1.5)]
      assert point(1.5, Transient: "true") == [line("X:d", 1.5)]
    end

    test "the unit" do
      no_unit = String.replace(line("X:d", 1.5), ",unit=V", "")
      assert point(1.5, Unit: "") == [no_unit]
      assert point(1.5, Unit: nil) == [no_unit]

      assert point(1.5, Unit: ~S(m/s, "x"=1 a\b)) == [
               String.replace(line("X:d", 1.5), "unit=V", ~S(unit=m/s\,\ "x"\=1\ a\b))
             ]
    end
  end

  describe "the topic" do
    defp topic_line(topic) do
      [line] = points(topic, json(1.5), props())
      String.replace(line, ",topLevelInstance=i-top,topLevelSchema=s-top,", ",…,")
    end

    test "gives the levels up to the first Edge, and the path after it" do
      assert topic_line("UNS/v1/AMRC/F2050/Edge/D1/Temp") ==
               "Temp:d,enterprise=AMRC,path=D1,site=F2050,…,unit=V,usesInstances=i-top:," <>
                 "usesSchemas=s-top: value=1.5 #{@ns1}\n"

      assert topic_line("UNS/v1/AMRC/Edge/D1/Temp") ==
               "Temp:d,enterprise=AMRC,path=D1,…,unit=V,usesInstances=i-top:," <>
                 "usesSchemas=s-top: value=1.5 #{@ns1}\n"

      assert topic_line("UNS/v1/AMRC//Shop/Edge/D1/Temp") ==
               "Temp:d,area=Shop,enterprise=AMRC,path=D1,…,unit=V,usesInstances=i-top:," <>
                 "usesSchemas=s-top: value=1.5 #{@ns1}\n"

      assert topic_line("UNS/v1/L1/L2/L3/L4/L5/L6/Edge/D1/Temp") ==
               "Temp:d,area=L3,enterprise=L1,path=D1,site=L2,…,unit=V,usesInstances=i-top:," <>
                 "usesSchemas=s-top:,workCenter=L4,workUnit=L5 value=1.5 #{@ns1}\n"

      assert topic_line(~s(UNS/v1/A, B/x=y/Edge/Dev 1/Group, 2/Temp, "C")) ==
               ~S(Temp\,\ "C":d,enterprise=A\,\ B,path=Dev\ 1/Group\,\ 2,site=x\=y,…,unit=V,) <>
                 "usesInstances=i-top:,usesSchemas=s-top: value=1.5 #{@ns1}\n"
    end

    test "as the JS read the odd ones" do
      # A level named Edge.
      assert topic_line("UNS/v1/Edge/F2050/Edge/D1/G/Temp") ==
               "Temp:d,path=F2050/Edge/D1/G,…,unit=V,usesInstances=i-top:," <>
                 "usesSchemas=s-top: value=1.5 #{@ns1}\n"

      # No Edge.
      assert topic_line("UNS/v1/AMRC/F2050/Shop/Cell 1/Robot/X/D1/Temp") ==
               "Temp:d,area=Shop,enterprise=AMRC,path=UNS/v1/AMRC/F2050/Shop/Cell\\ 1/Robot/X/D1," <>
                 "site=F2050,…,unit=V,usesInstances=i-top:,usesSchemas=s-top:," <>
                 "workCenter=Cell\\ 1,workUnit=Robot value=1.5 #{@ns1}\n"

      assert topic_line("UNS/v1/AMRC/Edge") ==
               "Edge:d,enterprise=AMRC,…,unit=V,usesInstances=i-top:," <>
                 "usesSchemas=s-top: value=1.5 #{@ns1}\n"

      assert topic_line(@dev <> "/") ==
               String.replace(
                 line(":d", 1.5),
                 ",topLevelInstance=i-top,topLevelSchema=s-top,",
                 ",…,"
               )

      assert topic_line(@dev <> "/Temp\\") =~ ~r/^Temp\\:d,/
    end

    # Differs: the JS wrote these lines, which InfluxDB reads as a
    # comment, or misreads.
    test "skips a line InfluxDB would misread" do
      {[], log} = with_log(fn -> points(@dev <> "/#x", json(1.5), props()) end)
      assert log =~ ~s(Skipped the value on "#{@dev}/#x": measurement starts with #)

      {[], log} = with_log(fn -> points("UNS/v1/AMRC\\/Edge/D1/Temp", json(1.5), props()) end)
      assert log =~ ~s(tag "enterprise" has a backslash at the end)
    end
  end

  describe "values" do
    test "of each Type" do
      cases = [
        {"Int8", "5", "i", "5i"},
        {"Int16", "-300", "i", "-300i"},
        {"Int32", "2147483648", "i", "2147483648i"},
        {"Int32", "1.0", "i", "1i"},
        {"Int32", "1e3", "i", "1000i"},
        # Differs: the JS rounded these, and crashed on the limits.
        {"Int64", "9007199254740993", "i", "9007199254740993i"},
        {"Int64", "-9007199254740993", "i", "-9007199254740993i"},
        {"Int64", "4611686018427387904", "i", "4611686018427387904i"},
        {"Int64", "9223372036854775807", "i", "9223372036854775807i"},
        {"Int64", "-9223372036854775808", "i", "-9223372036854775808i"},
        {"UInt8", "255", "u", "255u"},
        {"UInt64", "9007199254740991", "u", "9007199254740991u"},
        {"UInt64", "9007199254740992", "u", "9007199254740992u"},
        {"UInt64", "18446744073709551615", "u", "18446744073709551615u"},
        {"Float", "0.10000000149011612", "d", "0.10000000149011612"},
        {"Double", "5", "d", "5.0"},
        {"Double", "1e+21", "d", "1.0e21"},
        {"Double", "1.5e-7", "d", "1.5e-7"},
        {"Double", "-0", "d", "0.0"},
        {"Double", "123456789012345680000", "d", "1.2345678901234568e20"},
        {"Boolean", "true", "b", "T"},
        {"Boolean", "false", "b", "F"},
        {"String", ~S("a \"q\" \\ b\nc\td, e=f ñ€😀"), "s", ~s("a \\"q\\" \\\\ b\nc\td, e=f ñ€😀")},
        {"String", ~S("a\\"), "s", ~S("a\\")},
        {"String", ~S(""), "s", ~S("")},
        {"Text", ~S("text"), "s", ~S("text")},
        {"UUID", ~S("0f6f2a8e-5c3c-4b67-9e55-1d2c1f0e4a11"), "s",
         ~S("0f6f2a8e-5c3c-4b67-9e55-1d2c1f0e4a11")},
        {"DateTime", "1792531570001", "s", ~S("1792531570001")},
        {"DataSet", ~S("x"), "s", ~S("x")},
        {nil, ~S("x"), "s", ~S("x")},
        # Strings take numbers and booleans, as JS's String() does, but
        # integers exactly: the JS wrote 12345678901234567000.
        {"String", "1.5", "s", ~S("1.5")},
        {"String", "1e21", "s", ~S("1e+21")},
        {"String", "12345678901234567890", "s", ~S("12345678901234567890")},
        {"String", "true", "s", ~S("true")},
        {"Bytes", ~S("hi"), "s", ~S("hi")},
        # Differs: the JS wrote "[object Object]".
        {"Bytes", ~S({"type":"Buffer","data":[104,105,255]}), "s", ~s("hi�")},
        {"File", ~S({"type":"Buffer","data":[104,105]}), "s", ~S("hi")}
      ]

      for {type, value, suffix, field} <- cases do
        assert point(value, Type: type) == [line("X:" <> suffix, field)], "#{type} #{value}"
      end
    end

    test "a null is skipped silently" do
      for type <- ["Double", "Int32", "Boolean", "String", "Bytes"] do
        {points, log} = with_log(fn -> point("null", Type: type) end)
        assert points == []
        refute log =~ @dev
      end
    end

    # Differs: the JS coerced strings, booleans and arrays to numbers,
    # and wrote objects and arrays as strings.
    test "a value of the wrong JSON type is skipped" do
      cases = [
        {"Int32", ~S("12")},
        {"Int32", ~S("")},
        {"Int32", "true"},
        {"Int32", "false"},
        {"Int32", "1.5"},
        {"Int32", "[7]"},
        {"Int32", "{}"},
        {"UInt32", ~S("12")},
        {"Double", ~S("1.5")},
        {"Double", ~S("Infinity")},
        {"Double", "true"},
        {"Boolean", ~S("true")},
        {"Boolean", "1"},
        {"String", ~S({"a":1})},
        {"String", "[1,2]"},
        {"String", "[]"},
        {"Bytes", ~S({"type":"Buffer","data":[104,300]})},
        {"Bytes", ~S({"type":"Buffer","data":"hi"})}
      ]

      for {type, value} <- cases do
        {points, log} = with_log(fn -> point(value, Type: type) end)
        assert points == [], "#{type} #{value}"
        assert log =~ ~s(Skipped the value on "#{@dev}/X": its value, ), "#{type} #{value}"
        assert log =~ "isn't valid for #{type}"
      end

      assert capture_log(fn -> point("{}", Type: nil) end) =~ "isn't valid with no Type"
    end

    test "a missing value is skipped" do
      for type <- ["Double", "Int32", "Boolean", "String"] do
        {points, log} =
          with_log(fn -> points(@dev <> "/X", ~s({"timestamp":"#{@t1}"}), props(Type: type)) end)

        assert points == []
        assert log =~ "it has no value"
      end
    end

    # Differs: these crashed the JS.
    test "a value InfluxDB can't store is skipped" do
      cases = [
        {"UInt32", "-1", ~s(field "value" is outside uint64)},
        {"Int64", "9223372036854775808", ~s(field "value" is outside int64)},
        {"Int32", "1e20", ~s(field "value" is outside int64)},
        {"Double", "1e400", ~s(field "value" is infinite)},
        {"Double", "-1e400", ~s(field "value" is infinite)},
        {"Double", "1" <> String.duplicate("0", 400), ~s(field "value" is infinite)}
      ]

      for {type, value, reason} <- cases do
        {points, log} = with_log(fn -> point(value, Type: type) end)
        assert points == [], "#{type} #{value}"
        assert log =~ reason, "#{type} #{value}"
      end
    end
  end

  describe "timestamps" do
    test "fall back to the payload's, then to when the message arrived" do
      payload =
        ~s({"timestamp":"#{@t3}","value":3,"batch":[{"value":1},{"timestamp":"","value":2}]})

      assert points(@dev <> "/X", payload, props()) == [
               line("X:d", "3.0", @ns1 + 2_000_000),
               line("X:d", "1.0", @ns1 + 2_000_000),
               line("X:d", "2.0", @ns1 + 2_000_000)
             ]

      assert points(@dev <> "/X", ~s({"value":3,"batch":[{"value":1}]}), props()) == [
               line("X:d", "3.0", @received),
               line("X:d", "1.0", @received)
             ]

      for timestamp <- [~S(""), "0", "false", "null"] do
        assert points(@dev <> "/X", ~s({"timestamp":#{timestamp},"value":1}), props()) ==
                 [line("X:d", "1.0", @received)]
      end
    end

    # Differs: these crashed the JS.
    test "a sample whose timestamp isn't a string, or doesn't parse, is skipped" do
      payload =
        ~s({"timestamp":"#{@t1}","value":1,"batch":[) <>
          ~s({"timestamp":5,"value":2},{"timestamp":"#{@t2}","value":3}]})

      {points, log} = with_log(fn -> points(@dev <> "/X", payload, props()) end)
      assert points == [line("X:d", "1.0"), line("X:d", "3.0", @ns1 + 1_000_000)]

      assert log =~
               ~s(Skipped 1 of 3 values on "#{@dev}/X": its timestamp, 5, isn't a string)

      # The batch entries without a timestamp fall back to the bad one.
      payload =
        ~s({"timestamp":"garbage","value":1,"batch":[{"value":2},{"timestamp":"#{@t2}","value":3}]})

      {points, log} = with_log(fn -> points(@dev <> "/X", payload, props()) end)
      assert points == [line("X:d", "3.0", @ns1 + 1_000_000)]

      assert log =~
               ~s(Skipped 2 of 3 values on "#{@dev}/X"; the first: its timestamp, "garbage", isn't one JS would read)
    end

    # Differs: InfluxDB rejected the JS's whole batch, and it exited.
    test "a sample outside InfluxDB's range is skipped" do
      for timestamp <- [
            "2263-01-01T00:00:00.000000000Z",
            "+010000-01-01T00:00:00.000000000Z",
            "1600-01-01T00:00:00.000000000Z"
          ] do
        {points, log} = with_log(fn -> points(@dev <> "/X", json(1, timestamp), props()) end)
        assert points == []
        assert log =~ "timestamp is outside InfluxDB's range"
      end

      assert points(@dev <> "/X", json(1, "1969-12-31T23:59:59.500000000Z"), props()) ==
               [line("X:d", "1.0", -500_000_000)]
    end
  end

  describe "malformed messages" do
    defp skipped(topic \\ @dev <> "/X", payload, props) do
      {points, log} = with_log(fn -> points(topic, payload, props) end)
      assert points == []
      [_, reason] = Regex.run(~r/Skipped a message on "[^"]*": (.*)/, log)
      reason
    end

    # Differs: the JS crashed on all but the first.
    test "a message without the user properties the historian needs is skipped" do
      assert skipped(json(1), []) == "it has no user properties"

      assert skipped(json(1), props(SchemaUUIDPath: nil)) ==
               "it has no SchemaUUIDPath user property"

      assert skipped(json(1), props(InstanceUUIDPath: nil)) ==
               "it has no InstanceUUIDPath user property"

      assert {[], _log} =
               with_log(fn -> UnsHistorian.points(@dev <> "/X", json(1), %{}, @received) end)
    end

    # Differs: MQTT.js made each an array. The JS wrote two Units
    # unescaped, which InfluxDB can't parse, and crashed on two paths.
    test "a message with a property the historian reads given twice is skipped" do
      for key <- ~w(Unit Type InstanceUUIDPath SchemaUUIDPath Simulated RunId) do
        props = props(Simulated: "true", RunId: "r") ++ [{key, "x"}]
        assert skipped(json(1), props) == "it has the user property #{key} more than once"
      end

      # Others don't matter.
      assert point(1, InstanceUUID: "i-top") == [line("X:d", "1.0")]

      assert points(@dev <> "/X", json(1), props() ++ [{"Transient", "true"}]) == [
               line("X:d", "1.0")
             ]
    end

    # Differs: the JS crashed on JSON null and a batch that isn't an
    # array, and on a null batch entry, and wrote the payload's sample
    # for other bad entries.
    test "a payload that isn't a JSON object, or has a bad batch, is skipped" do
      assert skipped("{", props()) =~ "its payload isn't valid JSON"
      assert skipped("", props()) =~ "its payload isn't valid JSON"
      assert skipped("﻿" <> json(1), props()) =~ "its payload isn't valid JSON"
      assert skipped("null", props()) == "its payload isn't a JSON object"
      assert skipped("5", props()) == "its payload isn't a JSON object"

      assert skipped(~s({"timestamp":"#{@t1}","value":1,"batch":"x"}), props()) ==
               "its batch isn't a list"

      assert skipped(~s({"timestamp":"#{@t1}","value":1,"batch":[5]}), props()) ==
               "its batch has an entry that isn't a JSON object"

      assert points(@dev <> "/X", ~s({"timestamp":"#{@t1}","value":1,"batch":null}), props()) ==
               [line("X:d", "1.0")]
    end

    test "JSON is read as JS read it" do
      assert points(@dev <> "/X", ~s({"timestamp":"#{@t1}","value":1,"value":2}), props()) ==
               [line("X:d", "2.0")]

      assert points(@dev <> "/X", " \n" <> json(1) <> "\n ", props()) == [line("X:d", "1.0")]

      assert points(
               @dev <> "/X",
               ~s({"timestamp":"#{@t1}","value":"a) <> <<0xFF, 0xC3>> <> ~s(b"}),
               props(Type: "String")
             ) ==
               [line("X:s", ~s("a��b"))]

      # Differs: OTP's json refuses a lone surrogate, which JS wrote as
      # U+FFFD.
      assert skipped(~s({"timestamp":"#{@t1}","value":"a\\ud800b"}), props(Type: "String")) =~
               "its payload isn't valid JSON"
    end

    test "invalid UTF-8 in the topic or a user property is replaced, as MQTT.js does" do
      assert [line] = points(@dev <> "/X" <> <<0xFF>>, json(1), props(Unit: "V" <> <<0xFF>>))
      assert line =~ ~r/^X\x{FFFD}:d,.*unit=V\x{FFFD},/u
    end
  end
end
