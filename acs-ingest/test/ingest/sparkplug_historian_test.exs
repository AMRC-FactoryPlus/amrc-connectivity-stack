# ACS Ingest
# Tests for the points the Sparkplug historian writes
# Copyright 2026 University of Sheffield

defmodule Ingest.SparkplugHistorianTest do
  # The expected lines are the JS historian's, from the harness's
  # output.txt (see the design doc, "Behaviour to keep"), apart from the
  # differences the design doc agrees. A comment marks each one.

  use ExUnit.Case, async: true

  import ExUnit.CaptureLog
  import Ingest.Test.Sparkplug

  alias Ingest.SparkplugHistorian
  alias Ingest.Test.FakeInflux
  alias Ingest.Writer
  alias SparkplugB.Proto.Org.Eclipse.Tahu.Protobuf.Payload

  @moduletag :capture_log

  @t0 1_792_531_570_000
  @t0_ns 1_792_531_570_000_000_000
  @ns 1_792_531_570_123_456_789

  setup do
    name = :"sparkplug_#{System.unique_integer([:positive])}"

    start_supervised!(
      {Ingest.Sparkplug,
       name: name,
       subscribe: fn _filter -> :ok end,
       rebirth: fn _address -> :ok end,
       consumers: [{Ingest.Test.Consumer, pid: self()}]}
    )

    %{router: Ingest.Sparkplug.child(name, "Router")}
  end

  defp publish(ctx, topic, payload),
    do: send(ctx.router, {:fplus_mqtt, topic, payload, %{}})

  # The historian's lines for the next message, without their newlines.
  defp lines(ctx, topic, payload) do
    publish(ctx, topic, payload)
    assert_receive {:update, update}

    for line <- SparkplugHistorian.points(update),
        do: line |> IO.iodata_to_binary() |> String.replace_suffix("\n", "")
  end

  # The same, as the text of a write.
  defp text(ctx, topic, payload),
    do: ctx |> lines(topic, payload) |> Enum.map_join(&(&1 <> "\n"))

  defp dbirth(ctx, payload), do: text(ctx, "spBv1.0/G1/DBIRTH/N1/D1", payload)
  defp ddata(ctx, payload), do: lines(ctx, "spBv1.0/G1/DDATA/N1/D1", payload)

  defp uuid(name, value, alias), do: [name: name, type: :uuid, value: value, alias: alias]

  # Unwraps the newline in a heredoc's last line.
  defp line(heredoc), do: String.trim_trailing(heredoc, "\n")

  test "a Factory+ birth's tags, schemas and instances", ctx do
    birth =
      fplus_payload(
        [
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
          [name: "Secret", type: :string, value: "x", alias: 13, transient: true],
          [name: "Nothing", type: :double, value: nil, alias: 14],
          [
            name: ~S(Device Information/Model, "X"=1),
            type: :string,
            value: ~s(a "q" \\ b\nc),
            alias: 15
          ],
          [name: "Unit/Empty", type: :double, value: 1.0, alias: 16, unit: ""]
        ],
        timestamp: @t0
      )

    # JS: value=231 and value=1.
    {text, log} = with_log([level: :debug], fn -> dbirth(ctx, birth) end)

    assert text == ~S"""
           Schema_UUID:s,device=D1,group=G1,node=N1,topLevelInstance=i-top,topLevelSchema=s-top,usesInstances=i-top:,usesSchemas=s-top: value="s-top" 1792531570000000000
           Instance_UUID:s,device=D1,group=G1,node=N1,topLevelInstance=i-top,topLevelSchema=s-top,usesInstances=i-top:,usesSchemas=s-top: value="i-top" 1792531570000000000
           Schema_UUID:s,device=D1,group=G1,node=N1,path=Phases,topLevelInstance=i-top,topLevelSchema=s-top,usesInstances=i-top:,usesSchemas=s-top:s-phases value="s-phases" 1792531570000000000
           Schema_UUID:s,bottomLevelInstance=i-ph1,bottomLevelSchema=s-ph1,device=D1,group=G1,node=N1,path=Phases/1,topLevelInstance=i-top,topLevelSchema=s-top,usesInstances=i-top:i-ph1,usesSchemas=s-top:s-phases:s-ph1 value="s-ph1" 1792531570000000000
           Instance_UUID:s,bottomLevelInstance=i-ph1,bottomLevelSchema=s-ph1,device=D1,group=G1,node=N1,path=Phases/1,topLevelInstance=i-top,topLevelSchema=s-top,usesInstances=i-top:i-ph1,usesSchemas=s-top:s-phases:s-ph1 value="i-ph1" 1792531570000000000
           Voltage:d,bottomLevelInstance=i-ph1,bottomLevelSchema=s-ph1,device=D1,group=G1,node=N1,path=Phases/1,topLevelInstance=i-top,topLevelSchema=s-top,unit=V,usesInstances=i-top:i-ph1,usesSchemas=s-top:s-phases:s-ph1 value=230.5 1792531570000000000
           Schema_UUID:s,bottomLevelInstance=i-ph1,bottomLevelSchema=s-ph10,device=D1,group=G1,node=N1,path=Phases/10,topLevelInstance=i-top,topLevelSchema=s-top,usesInstances=i-top:i-ph1,usesSchemas=s-top:s-phases:s-ph1:s-ph10 value="s-ph10" 1792531570000000000
           Voltage:d,bottomLevelInstance=i-ph1,bottomLevelSchema=s-ph10,device=D1,group=G1,node=N1,path=Phases/10,topLevelInstance=i-top,topLevelSchema=s-top,unit=V,usesInstances=i-top:i-ph1,usesSchemas=s-top:s-phases:s-ph1:s-ph10 value=231.0 1792531570000000000
           Schema_UUID:s,bottomLevelSchema=s-ax1,device=D1,group=G1,node=N1,path=Axes/1/BaseAxis/Position,topLevelInstance=i-top,topLevelSchema=s-top,usesInstances=i-top:,usesSchemas=s-top:s-pos:s-ax1 value="s-pos" 1792531570000000000
           Schema_UUID:s,bottomLevelSchema=s-ax1,device=D1,group=G1,node=N1,path=Axes/1,topLevelInstance=i-top,topLevelSchema=s-top,usesInstances=i-top:,usesSchemas=s-top:s-ax1 value="s-ax1" 1792531570000000000
           Actual:d,bottomLevelSchema=s-ax1,device=D1,group=G1,node=N1,path=Axes/1/BaseAxis/Position,topLevelInstance=i-top,topLevelSchema=s-top,usesInstances=i-top:,usesSchemas=s-top:s-pos:s-ax1 value=1.5 1792531570000000000
           Status:s,device=D1,group=G1,node=N1,topLevelInstance=i-top,topLevelSchema=s-top,usesInstances=i-top:,usesSchemas=s-top: value="ok" 1792531570000000000
           Model\,\ "X"=1:s,device=D1,group=G1,node=N1,path=Device\ Information,topLevelInstance=i-top,topLevelSchema=s-top,usesInstances=i-top:,usesSchemas=s-top: value="a \"q\" \\ b
           c" 1792531570000000000
           Empty:d,device=D1,group=G1,node=N1,path=Unit,topLevelInstance=i-top,topLevelSchema=s-top,usesInstances=i-top:,usesSchemas=s-top: value=1.0 1792531570000000000
           """

    assert log =~ ~s(Skipped "Secret" from G1/N1/D1: it is transient)
    refute log =~ "Nothing"

    # A metric timestamp in nanoseconds.
    data = payload([[alias: 6, type: :double, value: 229.9, timestamp: @ns]], timestamp: @t0)

    assert ddata(ctx, data) == [
             line(~S"""
             Voltage:d,bottomLevelInstance=i-ph1,bottomLevelSchema=s-ph1,device=D1,group=G1,node=N1,path=Phases/1,topLevelInstance=i-top,topLevelSchema=s-top,unit=V,usesInstances=i-top:i-ph1,usesSchemas=s-top:s-phases:s-ph1 value=229.9 1792531570123456789
             """)
           ]
  end

  test "a birth that isn't Factory+ has null tops", ctx do
    birth =
      payload(
        [
          uuid("Schema_UUID", "s-top", 1),
          [name: "A/B/Value", type: :double, value: 1.0, alias: 2]
        ],
        timestamp: @t0
      )

    # JS: value=1.
    assert dbirth(ctx, birth) == ~S"""
           Schema_UUID:s,device=D1,group=G1,node=N1,usesInstances=null:,usesSchemas=null: value="s-top" 1792531570000000000
           Value:d,device=D1,group=G1,node=N1,path=A/B,usesInstances=null:,usesSchemas=null: value=1.0 1792531570000000000
           """
  end

  test "null UUIDs, and names that start or end with a slash", ctx do
    # Checked against the JS historian: a null top is left out and is
    # "null" in uses*, and a null in a chain joins as "".
    birth =
      fplus_payload(
        [
          uuid("Schema_UUID", "s-top", 1),
          uuid("Instance_UUID", nil, 2),
          uuid("A/Schema_UUID", nil, 3),
          [name: "A/V", type: :double, value: 1.0, alias: 4],
          [name: "Slash/", type: :double, value: 4.0, alias: 5],
          [name: "/Lead", type: :double, value: 5.0, alias: 6]
        ],
        timestamp: @t0
      )

    assert dbirth(ctx, birth) == ~S"""
           Schema_UUID:s,device=D1,group=G1,node=N1,topLevelSchema=s-top,usesInstances=null:,usesSchemas=s-top: value="s-top" 1792531570000000000
           V:d,device=D1,group=G1,node=N1,path=A,topLevelSchema=s-top,usesInstances=null:,usesSchemas=s-top: value=1.0 1792531570000000000
           :d,device=D1,group=G1,node=N1,path=Slash,topLevelSchema=s-top,usesInstances=null:,usesSchemas=s-top: value=4.0 1792531570000000000
           Lead:d,device=D1,group=G1,node=N1,topLevelSchema=s-top,usesInstances=null:,usesSchemas=s-top: value=5.0 1792531570000000000
           """
  end

  describe "every datatype" do
    @top_tags "device=D1,group=G1,node=N1,topLevelInstance=i-top,topLevelSchema=s-top," <>
                "usesInstances=i-top:,usesSchemas=s-top:"
    @types_tags "device=D1,group=G1,node=N1,path=Types,topLevelInstance=i-top," <>
                  "topLevelSchema=s-top,usesInstances=i-top:,usesSchemas=s-top:"

    # The harness's birth: {name, datatype, value}, with aliases from 1.
    @typed [
      {"Int8", :int8, -1},
      {"Int16", :int16, -300},
      {"Int32", :int32, -5},
      {"Int64", :int64, -5},
      {"UInt8", :uint8, 255},
      {"UInt16", :uint16, 65_535},
      {"UInt32", :uint32, 4_294_967_295},
      {"UInt64", :uint64, 9_007_199_254_740_993},
      {"Float", :float, 0.1},
      {"Double", :double, 5.0},
      {"Boolean", :boolean, true},
      {"String", :string, "s"},
      {"Text", :text, "t"},
      {"UUID", :uuid, "u"},
      {"DateTime", :date_time, @t0},
      {"Bytes", :bytes, <<"hi", 0xFF>>},
      {"File", :file, "f"}
    ]

    @alias @typed |> Enum.with_index(1) |> Map.new(fn {{_name, type, _v}, i} -> {type, i} end)

    setup ctx do
      metrics =
        for {name, type, value} <- @typed,
            do: [name: "Types/#{name}", type: type, value: value, alias: @alias[type]]

      birth =
        fplus_payload(
          [uuid("Schema_UUID", "s-top", 100), uuid("Instance_UUID", "i-top", 101) | metrics],
          timestamp: @t0
        )

      %{birth: lines(ctx, "spBv1.0/G1/DBIRTH/N1/D1", birth)}
    end

    defp point(measurement, value), do: "#{measurement},#{@types_tags} value=#{value} #{@t0_ns}"

    defp one(ctx, type, opts) do
      metric = Keyword.merge([alias: @alias[type], type: type], opts)
      ddata(ctx, payload([metric], timestamp: @t0))
    end

    test "in a birth", %{birth: birth} do
      # JS crashed on the Int64 -5, so wrote none of the birth. JS:
      # Double value=5.
      assert birth == [
               "Schema_UUID:s,#{@top_tags} value=\"s-top\" #{@t0_ns}",
               "Instance_UUID:s,#{@top_tags} value=\"i-top\" #{@t0_ns}",
               point("Int8:i", "-1i"),
               point("Int16:i", "-300i"),
               point("Int32:i", "-5i"),
               point("Int64:i", "-5i"),
               point("UInt8:u", "255u"),
               point("UInt16:u", "65535u"),
               point("UInt32:u", "4294967295u"),
               point("UInt64:u", "9007199254740993u"),
               point("Float:d", "0.10000000149011612"),
               point("Double:d", "5.0"),
               point("Boolean:b", "T"),
               point("String:s", ~s("s")),
               point("Text:s", ~s("t")),
               point("UUID:s", ~s("u")),
               point("DateTime:s", ~s("1792531570000")),
               point("Bytes:s", ~s("hi\uFFFD")),
               point("File:s", ~s("f"))
             ]
    end

    # {description, datatype, metric options, measurement, field}. A
    # comment gives what JS wrote, where it differs.
    @written [
      {"Int8 -1", :int8, [value: -1], "Int8:i", "-1i"},
      {"Int16 -300", :int16, [value: -300], "Int16:i", "-300i"},
      {"Int32 -5", :int32, [value: -5], "Int32:i", "-5i"},
      # JS crashed on every negative Int64.
      {"Int64 -5", :int64, [value: -5], "Int64:i", "-5i"},
      {"UInt8 255", :uint8, [value: 255], "UInt8:u", "255u"},
      {"UInt16 65535", :uint16, [value: 65_535], "UInt16:u", "65535u"},
      {"UInt32 2^32-1", :uint32, [value: 4_294_967_295], "UInt32:u", "4294967295u"},
      # JS crashed on UInt64s above 2^53-1.
      {"UInt64 2^53+1", :uint64, [value: 9_007_199_254_740_993], "UInt64:u", "9007199254740993u"},
      {"Float 0.1", :float, [value: 0.1], "Float:d", "0.10000000149011612"},
      # JS: value=5.
      {"Double 5", :double, [value: 5.0], "Double:d", "5.0"},
      {"Boolean true", :boolean, [value: true], "Boolean:b", "T"},
      {"String", :string, [value: "s"], "String:s", ~s("s")},
      {"Text", :text, [value: "t"], "Text:s", ~s("t")},
      {"UUID", :uuid, [value: "u"], "UUID:s", ~s("u")},
      {"DateTime", :date_time, [value: @t0], "DateTime:s", ~s("1792531570000")},
      {"Bytes", :bytes, [value: <<"hi", 0xFF>>], "Bytes:s", ~s("hi�")},
      {"File", :file, [value: "f"], "File:s", ~s("f")},
      # JS: 255i. Tahu sign-extends to 32 bits, which both read as -1.
      {"Int8 0xFF in int_value", :int8, [raw: {:int_value, 0xFF}], "Int8:i", "-1i"},
      # JS: 65535i.
      {"Int16 0xFFFF in int_value", :int16, [raw: {:int_value, 0xFFFF}], "Int16:i", "-1i"},
      {"Int32 2^31-1", :int32, [value: 2_147_483_647], "Int32:i", "2147483647i"},
      # JS crashed.
      {"Int64 -(2^53+1)", :int64, [value: -9_007_199_254_740_993], "Int64:i",
       "-9007199254740993i"},
      # JS rounded it: 9007199254740992i.
      {"Int64 2^53+1", :int64, [value: 9_007_199_254_740_993], "Int64:i", "9007199254740993i"},
      # JS crashed on these two.
      {"Int64 2^63-1", :int64, [value: 9_223_372_036_854_775_807], "Int64:i",
       "9223372036854775807i"},
      {"Int64 -2^63", :int64, [value: -9_223_372_036_854_775_808], "Int64:i",
       "-9223372036854775808i"},
      {"UInt32 2^31", :uint32, [value: 2_147_483_648], "UInt32:u", "2147483648u"},
      {"UInt64 2^53-1", :uint64, [value: 9_007_199_254_740_991], "UInt64:u", "9007199254740991u"},
      # JS crashed.
      {"UInt64 2^64-1", :uint64, [value: 18_446_744_073_709_551_615], "UInt64:u",
       "18446744073709551615u"},
      # JS: 1e+21.
      {"Double 1e21", :double, [value: 1.0e21], "Double:d", "1.0e21"},
      # JS: 0.
      {"Double -0", :double, [value: -0.0], "Double:d", "0.0"},
      {"Double 1.5e-7", :double, [value: 1.5e-7], "Double:d", "1.5e-7"},
      {"Boolean false", :boolean, [value: false], "Boolean:b", "F"},
      {"String empty", :string, [value: ""], "String:s", ~s("")},
      {"String escapes", :string, [value: "q\" b\\ n\n t\t"], "String:s",
       ~s("q\\" b\\\\ n\n t\t")},
      # JS skipped these two, and wrote 0i for the second.
      {"Double with no datatype", :double, [type: nil, raw: {:double_value, 7.5}], "Double:d",
       "7.5"},
      {"Int32 in long_value", :int32, [raw: {:long_value, 42}], "Int32:i", "42i"}
    ]

    for {description, type, opts, measurement, field} <- @written do
      @datatype type
      @opts opts
      @measurement measurement
      @field field

      test "DATA: #{description}", ctx do
        assert one(ctx, @datatype, @opts) == [point(@measurement, @field)]
      end
    end

    # {description, datatype, metric options, log}. A comment gives what
    # JS did, where it differs.
    @skipped [
      {"Float NaN", :float, [value: :nan],
       ~s(Skipped "Types/Float" from G1/N1/D1: field "value" is NaN)},
      # JS crashed.
      {"Float Infinity", :float, [value: :infinity], ~s(field "value" is infinite)},
      # JS dropped the whole payload.
      {"DataSet for a String", :string,
       [
         type: :data_set,
         raw:
           {:dataset_value,
            %Payload.DataSet{
              num_of_columns: 1,
              columns: ["a"],
              types: [3],
              rows: [
                %Payload.DataSet.Row{
                  elements: [%Payload.DataSet.DataSetValue{value: {:int_value, 1}}]
                }
              ]
            }}
       ], "its DATA has datatype data_set, but its birth has datatype string"},
      # JS: "[object Object]".
      {"Template for a String", :string,
       [
         type: :template,
         raw:
           {:template_value,
            %Payload.Template{
              metrics: [%Payload.Metric{name: "x", datatype: 3, value: {:int_value, 1}}]
            }}
       ], "its DATA has datatype template, but its birth has datatype string"},
      {"Int8Array for a String", :string, [type: :int8_array, raw: {:bytes_value, <<1, 2>>}],
       "its DATA has datatype int8_array, but its birth has datatype string"},
      {"Double 1.5 for an Int32", :int32, [type: :double, value: 1.5],
       "its DATA has datatype double, but its birth has datatype int32"},
      # JS: 3i.
      {"Double 3.0 for an Int32", :int32, [type: :double, value: 3.0],
       "its DATA has datatype double, but its birth has datatype int32"},
      {"String \"true\" for a Boolean", :boolean, [type: :string, value: "true"],
       "its DATA has datatype string, but its birth has datatype boolean"},
      # JS: "9".
      {"Int32 9 for a String", :string, [type: :int32, value: 9],
       "its DATA has datatype int32, but its birth has datatype string"},
      # JS wrote it: it only checked the birth's transient flag.
      {"transient flag on DATA only", :double, [value: 2.0, transient: true],
       ~s(Skipped "Types/Double" from G1/N1/D1: it is transient)},
      # JS would have written 300i; SparkplugB leaves it raw.
      {"Int8 300", :int8, [raw: {:int_value, 300}],
       ~s(its value, {:int_value, 300}, isn't valid for datatype int8)},
      {"Int32 in double_value", :int32, [raw: {:double_value, 1.5}],
       ~s(its value, {:double_value, 1.5}, isn't valid for datatype int32)}
    ]

    for {description, type, opts, message} <- @skipped do
      @datatype type
      @opts opts
      @message message

      test "DATA skipped: #{description}", ctx do
        {lines, log} = with_log([level: :debug], fn -> one(ctx, @datatype, @opts) end)
        assert lines == []
        assert log =~ @message
      end
    end

    test "DATA skipped silently: no value, or null", ctx do
      for opts <- [[type: :double], [type: :double, value: nil]] do
        {lines, log} = with_log([level: :debug], fn -> one(ctx, :double, opts) end)
        assert lines == []
        refute log =~ "Skipped"
      end
    end

    test "a skipped metric leaves the rest of the payload", ctx do
      # JS crashed on the Infinity, losing the payload.
      data =
        payload(
          [
            [alias: @alias[:float], type: :float, value: :infinity],
            [alias: @alias[:double], type: :double, value: 8.0]
          ],
          timestamp: @t0
        )

      assert ddata(ctx, data) == [point("Double:d", "8.0")]
    end
  end

  describe "timestamps" do
    setup ctx do
      birth = fplus_payload([[name: "V", type: :double, value: 1.0, alias: 1]])
      %{birth: lines(ctx, "spBv1.0/G1/DBIRTH/N1/D1", birth)}
    end

    defp v(ctx, value, timestamp, payload_timestamp) do
      metric = [alias: 1, type: :double, value: value, timestamp: timestamp]
      ddata(ctx, payload([metric], timestamp: payload_timestamp))
    end

    defp at(value, ns) do
      "V:d,device=D1,group=G1,node=N1,usesInstances=null:,usesSchemas=null: value=#{value} #{ns}"
    end

    defp arrival(lines) do
      [line] = lines
      [_series, _field, ns] = String.split(line, " ")
      String.to_integer(ns)
    end

    test "with none, when the message arrived", %{birth: birth} = ctx do
      # JS: in milliseconds.
      assert_in_delta arrival(birth), System.os_time(:nanosecond), 5_000_000_000
      assert_in_delta arrival(v(ctx, 6.0, nil, nil)), System.os_time(:nanosecond), 5_000_000_000
    end

    test "the metric's, else the payload's, in either unit", ctx do
      assert v(ctx, 2.0, @ns, @t0) == [at("2.0", @ns)]
      assert v(ctx, 3.0, @t0 + 1, @t0 + 5) == [at("3.0", (@t0 + 1) * 1_000_000)]
      assert v(ctx, 4.0, nil, @ns) == [at("4.0", @ns)]
      assert v(ctx, 5.0, nil, @t0 + 7) == [at("5.0", (@t0 + 7) * 1_000_000)]
      assert v(ctx, 7.0, 0, @t0) == [at("7.0", 0)]
    end

    test "skips one InfluxDB can't store", ctx do
      # Read as milliseconds, it is after 2262. JS wrote it, and InfluxDB
      # would have rejected the batch.
      {lines, log} = with_log(fn -> v(ctx, 8.0, 999_999_999_999_999, @t0) end)
      assert lines == []
      assert log =~ ~s(Skipped "V" from G1/N1/D1: timestamp is outside InfluxDB's range)
    end
  end

  describe "simulated-data markers" do
    @simulated_tags "device=D1,group=G1,node=N1,run_id=r1,simulated=true," <>
                      "usesInstances=null:,usesSchemas=null:"

    setup ctx do
      metric = [
        name: "V",
        type: :double,
        value: 1.0,
        alias: 1,
        properties: [simulated: {:boolean, true}, run_id: {:string, "birth-run"}]
      ]

      %{birth: dbirth(ctx, fplus_payload([metric], timestamp: @t0))}
    end

    defp marked(ctx, properties) do
      metric = [alias: 1, type: :double, value: 2.0, properties: properties]
      ddata(ctx, payload([metric], timestamp: @t0))
    end

    defp tags(ctx, properties) do
      [line] = marked(ctx, properties)
      [series, _field, _ns] = String.split(line, " ")
      series |> String.split(",") |> tl() |> Enum.join(",")
    end

    @plain_tags "device=D1,group=G1,node=N1,usesInstances=null:,usesSchemas=null:"

    test "in a birth", %{birth: birth} do
      assert birth == """
             V:d,device=D1,group=G1,node=N1,run_id=birth-run,simulated=true,usesInstances=null:,usesSchemas=null: value=1.0 #{@t0_ns}
             """
    end

    test "come from the DATA metric's own properties", ctx do
      assert tags(ctx, simulated: {:boolean, true}, run_id: {:string, "r1"}) == @simulated_tags

      assert tags(ctx, simulated: {:boolean, true}, run_id: {:uint64, 42}) ==
               String.replace(@simulated_tags, "r1", "42")

      assert tags(ctx, simulated: {:boolean, true}) ==
               String.replace(@simulated_tags, "run_id=r1,", "")

      assert tags(ctx, simulated: {:boolean, false}, run_id: {:string, "r2"}) == @plain_tags
      assert tags(ctx, []) == @plain_tags
    end

    test "are truthy as in JS", ctx do
      only_simulated = String.replace(@simulated_tags, "run_id=r1,", "")
      assert tags(ctx, simulated: {:string, "no"}) == only_simulated
      assert tags(ctx, simulated: {:string, ""}) == @plain_tags
      assert tags(ctx, simulated: {:int32, 0}) == @plain_tags
      assert tags(ctx, simulated: {:boolean, true}, run_id: {:string, ""}) == only_simulated
    end

    test "ignore a DATA metric's unit", ctx do
      assert tags(ctx, engUnit: {:string, "kPa"}) == @plain_tags
    end

    test "skip a point whose run_id isn't a string or integer", ctx do
      {lines, log} =
        with_log(fn -> marked(ctx, simulated: {:boolean, true}, run_id: {:double, 1.5}) end)

      assert lines == []
      assert log =~ ~s(Skipped "V" from G1/N1/D1: its run_id, 1.5, isn't a string or an integer)
    end
  end

  test "names-only metrics resolve by name", ctx do
    birth =
      fplus_payload(
        [[name: "A", type: :double, value: 1.5], [name: "B", type: :int32, value: 2]],
        timestamp: @t0
      )

    # JS resolved every metric to B, so it skipped A's 1.5 and wrote 3i
    # for A's 3.0.
    assert dbirth(ctx, birth) == """
           A:d,device=D1,group=G1,node=N1,usesInstances=null:,usesSchemas=null: value=1.5 #{@t0_ns}
           B:i,device=D1,group=G1,node=N1,usesInstances=null:,usesSchemas=null: value=2i #{@t0_ns}
           """

    data = payload([[name: "A", type: :double, value: 3.0]], timestamp: @t0)

    assert ddata(ctx, data) == [
             "A:d,device=D1,group=G1,node=N1,usesInstances=null:,usesSchemas=null: value=3.0 #{@t0_ns}"
           ]
  end

  test "node births and node data make no points", ctx do
    metrics = [[name: "bdSeq", type: :uint64, value: 1], [name: "X", type: :double, value: 1.0]]
    assert text(ctx, "spBv1.0/G1/NBIRTH/N1", payload(metrics, timestamp: @t0)) == ""

    data = payload([[name: "X", type: :double, value: 2.0]], timestamp: @t0)
    assert text(ctx, "spBv1.0/G1/NDATA/N1", data) == ""
  end

  test "datatypes it doesn't write are logged once, at the birth", ctx do
    template = %Payload.Template{metrics: [%Payload.Metric{name: "x", datatype: 3}]}

    birth =
      payload(
        [
          [name: "T", type: :template, raw: {:template_value, template}, alias: 1],
          [name: "Arr", type: :int8_array, raw: {:bytes_value, <<1, 2>>}, alias: 2],
          [name: "None", raw: {:double_value, 1.0}, alias: 3],
          [name: "V", type: :double, value: 1.0, alias: 4]
        ],
        timestamp: @t0
      )

    {text, log} = with_log(fn -> dbirth(ctx, birth) end)

    assert text == """
           V:d,device=D1,group=G1,node=N1,usesInstances=null:,usesSchemas=null: value=1.0 #{@t0_ns}
           """

    assert log =~
             "Won't write 3 metrics of G1/N1/D1, as the historian doesn't write their datatypes: " <>
               ~s["T" (datatype template), "Arr" (datatype int8_array), "None" (no datatype)]

    data =
      payload([[alias: 1, type: :template, raw: {:template_value, template}]], timestamp: @t0)

    {lines, log} = with_log([level: :debug], fn -> ddata(ctx, data) end)
    assert lines == []
    assert log =~ ~s(Skipped "T" from G1/N1/D1: the historian doesn't write datatype template)
    refute log =~ "Won't write"
  end

  describe "skips with a warning" do
    defp skipped(ctx, metrics) do
      {text, log} = with_log(fn -> dbirth(ctx, fplus_payload(metrics, timestamp: @t0)) end)
      assert text == ""
      log
    end

    test "a line InfluxDB would misread", ctx do
      # JS wrote these: path=Dir\, swallows the comma, and #Hash:d is a
      # comment to InfluxDB.
      log =
        skipped(ctx, [
          [name: ~S(Dir\/Value), type: :double, value: 2.0, alias: 1],
          [name: "#Hash", type: :double, value: 3.0, alias: 2]
        ])

      assert log =~
               ~S(Skipped "Dir\\/Value" from G1/N1/D1: tag "path" has a backslash at the end) <>
                 " or before a character that needs escaping"

      assert log =~
               ~s(Skipped "#Hash" from G1/N1/D1: measurement starts with #, ) <>
                 "so InfluxDB would read the line as a comment"
    end

    test "a point whose birth has a UUID that isn't a string", ctx do
      log =
        skipped(ctx, [
          [name: "Schema_UUID", type: :int32, value: 5, alias: 1],
          [name: "V", type: :double, value: 1.0, alias: 2]
        ])

      for name <- ["Schema_UUID", "V"] do
        assert log =~
                 ~s(Skipped "#{name}" from G1/N1/D1: ) <>
                   "a Schema_UUID or Instance_UUID in its birth isn't a string"
      end
    end

    test "a point whose unit isn't a string", ctx do
      metric = [name: "V", type: :double, value: 1.0, properties: [engUnit: {:int32, 5}]]
      log = skipped(ctx, [metric])
      assert log =~ ~s(Skipped "V" from G1/N1/D1: its unit, 5, isn't a string)
    end
  end

  test "writes each message's points through its writer" do
    test = self()

    url =
      start_supervised!(
        {FakeInflux,
         fn request ->
           send(test, {:request, request.body})
           {204, [], ""}
         end}
      )
      |> FakeInflux.url()

    n = System.unique_integer([:positive])
    start_supervised!({Finch, name: :"finch_#{n}"})

    writer =
      start_supervised!(
        {Writer,
         name: :"writer_#{n}",
         finch: :"finch_#{n}",
         url: url,
         org: "org",
         bucket: "bucket",
         token: "token",
         batch_size: 1,
         flush_interval: 10}
      )

    name = :"historian_#{n}"

    start_supervised!(
      {Ingest.Sparkplug,
       name: name,
       subscribe: fn _filter -> :ok end,
       rebirth: fn _address -> :ok end,
       consumers: [{SparkplugHistorian, writer: writer}]},
      id: name
    )

    router = Ingest.Sparkplug.child(name, "Router")
    send_message = &send(router, {:fplus_mqtt, &1, &2, %{}})

    send_message.("spBv1.0/G1/NBIRTH/N1", payload([[name: "X", type: :double, value: 1.0]]))

    send_message.(
      "spBv1.0/G1/DBIRTH/N1/D1",
      payload(
        [
          [name: "A", type: :double, value: 1.0, alias: 1],
          [name: "B", type: :int32, value: 2, alias: 2]
        ],
        timestamp: @t0
      )
    )

    send_message.(
      "spBv1.0/G1/DDATA/N1/D1",
      payload([[alias: 2, type: :int32, value: 3]], timestamp: @t0)
    )

    tags = "device=D1,group=G1,node=N1,usesInstances=null:,usesSchemas=null:"

    # The node's birth made no request, and each device message one.
    assert_receive {:request, birth}, 2000
    assert birth == "A:d,#{tags} value=1.0 #{@t0_ns}\nB:i,#{tags} value=2i #{@t0_ns}\n"
    assert_receive {:request, data}, 2000
    assert data == "B:i,#{tags} value=3i #{@t0_ns}\n"
    refute_receive {:request, _body}, 100
  end
end
