# ACS Ingest
# Tests for the messages the UNS ingester publishes
# Copyright 2026 University of Sheffield

defmodule Ingest.UnsIngesterTest do
  # The expected messages are the JS UNS ingester's, from the harness's
  # uns-output.txt (see the design doc's UNS ingester section), apart
  # from the differences the design doc agrees. A comment marks each one.

  use ExUnit.Case, async: true

  import ExUnit.CaptureLog
  import Ingest.Test.Sparkplug

  alias Ingest.UnsIngester
  alias Ingest.UnsPayload
  alias SparkplugB.Proto.Org.Eclipse.Tahu.Protobuf.Payload

  @moduletag :capture_log

  @t0 1_792_531_570_000
  @ns 1_792_531_570_123_456_789
  @hierarchy_v1 "84ac3397-f3a2-440a-99e5-5bb9f6a75091"
  @full [
    Enterprise: "AMRC",
    Site: "F2050",
    Area: "Shop",
    "Work Center": "Cell 1",
    "Work Unit": "Robot"
  ]
  @prefix "UNS/v1/AMRC/F2050/Shop/Cell 1/Robot/Edge/D1/"

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

  # The messages for the next Sparkplug message, or [] if it makes no
  # update.
  defp messages(ctx, topic, payload) do
    send(ctx.router, {:fplus_mqtt, topic, payload, %{}})

    receive do
      {:update, update} -> UnsIngester.messages(update)
    after
      200 -> []
    end
  end

  defp dbirth(ctx, payload, device \\ "D1"),
    do: messages(ctx, "spBv1.0/G1/DBIRTH/N1/#{device}", payload)

  defp ddata(ctx, payload, device \\ "D1"),
    do: messages(ctx, "spBv1.0/G1/DDATA/N1/#{device}", payload)

  # A timestamp `ms` after T0, as the UNS writes it.
  defp at(ms), do: "2026-10-20T21:26:10.#{String.pad_leading("#{ms}", 3, "0")}000000Z"

  defp json(ms, value), do: ~s({"timestamp":"#{at(ms)}","value":#{value}})

  # The user properties, for the usual tops and no chains.
  defp props(type, opts \\ []) do
    [
      {"InstanceUUID", "i-top"},
      {"SchemaUUID", "s-top"},
      {"Transient", Keyword.get(opts, :transient, "false")},
      {"Unit", Keyword.get(opts, :unit, "")},
      {"Type", type},
      {"InstanceUUIDPath", Keyword.get(opts, :instances, "i-top:")},
      {"SchemaUUIDPath", Keyword.get(opts, :schemas, "s-top:")}
    ] ++ Keyword.get(opts, :extra, [])
  end

  defp tops do
    [
      [name: "Schema_UUID", type: :uuid, value: "s-top", alias: 800, timestamp: @t0 + 1],
      [name: "Instance_UUID", type: :uuid, value: "i-top", alias: 801, timestamp: @t0 + 1]
    ]
  end

  # The metrics of an ISA-95 hierarchy, at a path.
  defp hierarchy(levels, at \\ "Device_Information/ISA95_Hierarchy") do
    schema = [
      name: "#{at}/Schema_UUID",
      type: :uuid,
      value: @hierarchy_v1,
      alias: 900,
      timestamp: @t0 + 1
    ]

    levels =
      for {{level, value}, i} <- Enum.with_index(levels) do
        type = if is_integer(value), do: :int32, else: :string
        [name: "#{at}/#{level}", type: type, value: value, alias: 901 + i, timestamp: @t0 + 1]
      end

    [schema | levels]
  end

  defp birth(metrics), do: fplus_payload(tops() ++ hierarchy(@full) ++ metrics, timestamp: @t0)

  defp hierarchy_messages do
    for {level, value} <- @full do
      {@prefix <> "Device_Information/ISA95_Hierarchy/#{level}", json(1, ~s("#{value}")),
       props("String", schemas: "s-top:#{@hierarchy_v1}")}
    end
  end

  describe "a Factory+ birth with a full hierarchy" do
    setup ctx do
      birth =
        birth([
          [
            name: "Phases/1/Schema_UUID",
            type: :uuid,
            value: "s-ph1",
            alias: 3,
            timestamp: @t0 + 1
          ],
          [
            name: "Phases/1/Instance_UUID",
            type: :uuid,
            value: "i-ph1",
            alias: 4,
            timestamp: @t0 + 1
          ],
          [
            name: "Phases/1/Voltage",
            type: :double,
            value: 230.5,
            alias: 5,
            unit: "V",
            timestamp: @t0 + 1
          ],
          [name: "Phases/10/Voltage", type: :double, value: 231.0, alias: 6, timestamp: @t0 + 1],
          [name: "Status", type: :string, value: "ok", alias: 7, timestamp: @t0 + 1],
          [
            name: "Secret",
            type: :string,
            value: "x",
            alias: 8,
            transient: true,
            timestamp: @t0 + 1
          ],
          [name: "Nothing", type: :double, value: nil, alias: 9, timestamp: @t0 + 1],
          [
            name: "Device Control/Rebirth",
            type: :boolean,
            value: false,
            alias: 10,
            timestamp: @t0 + 1
          ],
          [name: "My Device Controls/X", type: :int32, value: 1, alias: 11, timestamp: @t0 + 1],
          [
            name: "Unit/Empty",
            type: :double,
            value: 1.0,
            alias: 12,
            unit: "",
            timestamp: @t0 + 1
          ],
          [
            name: ~s(Device Information/Model, "X"=1),
            type: :string,
            value: ~s(a "q" \\ b\nc),
            alias: 13,
            timestamp: @t0 + 1
          ]
        ])

      %{birth: dbirth(ctx, birth)}
    end

    test "publishes each metric, with the hierarchy's own", %{birth: birth} do
      volts = props("Double", unit: "V", instances: "i-top:i-ph1", schemas: "s-top:s-ph1")

      assert birth ==
               hierarchy_messages() ++
                 [
                   {@prefix <> "Phases/1/Voltage", json(1, "230.5"), volts},
                   {@prefix <> "Phases/10/Voltage", json(1, "231"),
                    props("Double", instances: "i-top:i-ph1", schemas: "s-top:s-ph1")},
                   {@prefix <> "Status", json(1, ~s("ok")), props("String")},
                   {@prefix <> "Secret", json(1, ~s("x")), props("String", transient: "true")},
                   {@prefix <> "Unit/Empty", json(1, "1"), props("Double")},
                   {@prefix <> ~s(Device Information/Model, "X"=1),
                    json(1, ~S("a \"q\" \\ b\nc")), props("String")}
                 ]
    end

    test "groups a metric's samples, newest as the value", ctx do
      data =
        payload(
          [
            [alias: 5, type: :double, value: 2.0, timestamp: @t0 + 20],
            [alias: 7, type: :string, value: "busy", timestamp: @t0 + 15],
            [alias: 5, type: :double, value: 3.0, timestamp: @t0 + 30],
            [alias: 5, type: :double, value: 1.0, timestamp: @t0 + 10]
          ],
          timestamp: @t0
        )

      volts = props("Double", unit: "V", instances: "i-top:i-ph1", schemas: "s-top:s-ph1")

      assert ddata(ctx, data) == [
               {@prefix <> "Phases/1/Voltage",
                ~s({"timestamp":"#{at(30)}","value":3,"batch":[) <>
                  ~s({"timestamp":"#{at(10)}","value":1},{"timestamp":"#{at(20)}","value":2}]}),
                volts},
               {@prefix <> "Status", json(15, ~s("busy")), props("String")}
             ]
    end

    test "keeps nanoseconds, and the payload's order for equal timestamps", ctx do
      data = payload([[alias: 5, type: :double, value: 229.9, timestamp: @ns]], timestamp: @t0)

      assert [{_topic, ~s({"timestamp":"2026-10-20T21:26:10.123456789Z","value":229.9}), _}] =
               ddata(ctx, data)

      data =
        payload(
          [
            [alias: 5, type: :double, value: 1.0, timestamp: @t0 + 40],
            [alias: 5, type: :double, value: 2.0, timestamp: @t0 + 40]
          ],
          timestamp: @t0
        )

      assert [{_topic, payload, _props}] = ddata(ctx, data)

      assert payload ==
               ~s({"timestamp":"#{at(40)}","value":2,"batch":[{"timestamp":"#{at(40)}","value":1}]})
    end

    test "skips null values, and publishes transient metrics", ctx do
      data =
        payload(
          [
            [alias: 5, type: :double, value: nil, timestamp: @t0 + 50],
            [alias: 5, type: :double, value: 4.0, timestamp: @t0 + 41],
            [alias: 8, type: :string, value: "y", timestamp: @t0 + 60],
            [alias: 10, type: :boolean, value: true, timestamp: @t0 + 60]
          ],
          timestamp: @t0
        )

      assert [
               {@prefix <> "Phases/1/Voltage", payload, _},
               {@prefix <> "Secret", secret, [_, _, {"Transient", "true"} | _]}
             ] = ddata(ctx, data)

      assert payload == json(41, "4")
      assert secret == json(60, ~s("y"))
    end

    # JS: published nothing for the metric by name, as it only looked up
    # aliases.
    test "resolves DATA by name when it has no alias", ctx do
      data =
        payload([[name: "Status", type: :string, value: "by-name", timestamp: @t0 + 80]],
          timestamp: @t0
        )

      assert ddata(ctx, data) == [{@prefix <> "Status", json(80, ~s("by-name")), props("String")}]
    end
  end

  describe "the hierarchy" do
    defp device(ctx, name, levels, at \\ "Device_Information/ISA95_Hierarchy") do
      metrics =
        tops() ++
          hierarchy(levels, at) ++
          [[name: "A/V", type: :double, value: 1.0, alias: 1, timestamp: @t0 + 1]]

      with_log(fn -> dbirth(ctx, fplus_payload(metrics, timestamp: @t0), name) end)
    end

    defp topics({messages, _log}), do: Enum.map(messages, &elem(&1, 0))

    test "goes down to the first level a birth doesn't have", ctx do
      assert topics(device(ctx, "Ent", Enterprise: "E")) == [
               "UNS/v1/E/Edge/Ent/Device_Information/ISA95_Hierarchy/Enterprise",
               "UNS/v1/E/Edge/Ent/A/V"
             ]

      assert "UNS/v1/E/S/Edge/Site/A/V" in topics(device(ctx, "Site", Enterprise: "E", Site: "S"))

      assert "UNS/v1/E/S/A/W/Edge/WC/A/V" in topics(
               device(ctx, "WC", Enterprise: "E", Site: "S", Area: "A", "Work Center": "W")
             )

      # Area and Work Center are there, but not Site.
      assert "UNS/v1/E/Edge/Gap/A/V" in topics(
               device(ctx, "Gap", Enterprise: "E", Area: "A", "Work Center": "W")
             )
    end

    test "keeps an empty level, and writes numbers", ctx do
      assert "UNS/v1/E//A/Edge/EmptySite/A/V" in topics(
               device(ctx, "EmptySite", Enterprise: "E", Site: "", Area: "A")
             )

      assert "UNS/v1/E/5/Edge/NumSite/A/V" in topics(
               device(ctx, "NumSite", Enterprise: "E", Site: 5)
             )
    end

    test "uses the last one under Device_Information/ISA95_Hierarchy", ctx do
      metrics =
        tops() ++
          hierarchy([Enterprise: "Wrong"], "Other/ISA95") ++
          Enum.map(
            hierarchy(Enterprise: "Right"),
            &Keyword.update!(&1, :alias, fn a -> a + 50 end)
          ) ++
          [[name: "A/V", type: :double, value: 1.0, alias: 1, timestamp: @t0 + 1]]

      {messages, log} =
        with_log(fn -> dbirth(ctx, fplus_payload(metrics, timestamp: @t0), "Two") end)

      assert Enum.map(messages, &elem(&1, 0)) == [
               "UNS/v1/Right/Edge/Two/Other/ISA95/Enterprise",
               "UNS/v1/Right/Edge/Two/Device_Information/ISA95_Hierarchy/Enterprise",
               "UNS/v1/Right/Edge/Two/A/V"
             ]

      assert log =~
               ~s(Ignored the Hierarchy-v1 schema at "Other/ISA95" in the birth of G1/N1/Two: ) <>
                 "it isn't under Device_Information/ISA95_Hierarchy"
    end

    test "a device without one isn't published, and its birth says why", ctx do
      for {name, levels, at, reason} <- [
            {"None", [], nil, "its birth has no ISA-95 hierarchy"},
            {"EmptyEnt", [Enterprise: "", Site: "S"], nil, ~s(its ISA-95 enterprise is "")},
            {"Wrong place", [Enterprise: "E"], "Hierarchy", "its birth has no ISA-95 hierarchy"}
          ] do
        metrics =
          tops() ++
            if(levels == [],
              do: [],
              else: hierarchy(levels, at || "Device_Information/ISA95_Hierarchy")
            ) ++
            [[name: "A/V", type: :double, value: 1.0, alias: 1, timestamp: @t0 + 1]]

        {messages, log} =
          with_log(fn -> dbirth(ctx, fplus_payload(metrics, timestamp: @t0), name) end)

        assert messages == []
        assert log =~ "Won't publish G1/N1/#{name} to the UNS: #{reason}"

        # Its DATA is skipped silently.
        data =
          payload([[alias: 1, type: :double, value: 2.0, timestamp: @t0 + 2]], timestamp: @t0)

        {messages, log} = with_log(fn -> ddata(ctx, data, name) end)
        assert messages == []
        refute log =~ "Won't publish"
      end
    end

    test "a payload that isn't Factory+'s has none", ctx do
      metrics =
        tops() ++
          hierarchy(Enterprise: "E") ++ [[name: "A/V", type: :double, value: 1.0, alias: 1]]

      {messages, log} = with_log(fn -> dbirth(ctx, payload(metrics, timestamp: @t0), "NotFP") end)
      assert messages == []
      assert log =~ "Won't publish G1/N1/NotFP to the UNS: its birth has no ISA-95 hierarchy"
    end

    # JS: warned for every topic of every message.
    test "a device without top-level UUIDs isn't published, and its birth says why", ctx do
      for {name, tops, reason} <- [
            {"NoTops", [], "its birth has no top-level Instance_UUID"},
            {"NoSchema", [Enum.at(tops(), 1)], "its birth has no top-level Schema_UUID"}
          ] do
        metrics =
          tops ++
            hierarchy(Enterprise: "E") ++
            [[name: "A/V", type: :double, value: 1.0, alias: 1, timestamp: @t0 + 1]]

        {messages, log} =
          with_log(fn -> dbirth(ctx, fplus_payload(metrics, timestamp: @t0), name) end)

        assert messages == []
        assert log =~ "Won't publish G1/N1/#{name} to the UNS: #{reason}"
      end
    end

    # JS: published to topics with + and # in them, which MQTT forbids.
    test "a device whose topics MQTT forbids isn't published", ctx do
      {messages, log} = device(ctx, "Slashes", Enterprise: "E/x", Site: "S+#")
      assert messages == []

      assert log =~
               "Won't publish G1/N1/Slashes to the UNS: its topics would have +, # or U+0000 in them"
    end

    test "a metric at the top level has no path", ctx do
      metrics =
        tops() ++
          hierarchy(Enterprise: "E") ++
          [[name: "V", type: :double, value: 1.0, alias: 1, timestamp: @t0 + 1]]

      assert [_, {"UNS/v1/E/Edge/TopLevel/V", _, _}] =
               dbirth(ctx, fplus_payload(metrics, timestamp: @t0), "TopLevel")
    end
  end

  describe "values" do
    @typed [
      int8: -1,
      int16: -300,
      int32: -5,
      int64: -5,
      uint8: 255,
      uint16: 65_535,
      uint32: 4_294_967_295,
      uint64: 9_007_199_254_740_993,
      float: 0.1,
      double: 5.0,
      boolean: true,
      string: "s",
      text: "t",
      uuid: "u",
      date_time: @t0,
      bytes: <<104, 105, 255>>,
      file: "f"
    ]

    @names %{
      int8: "Int8",
      int16: "Int16",
      int32: "Int32",
      int64: "Int64",
      uint8: "UInt8",
      uint16: "UInt16",
      uint32: "UInt32",
      uint64: "UInt64",
      float: "Float",
      double: "Double",
      boolean: "Boolean",
      string: "String",
      text: "Text",
      uuid: "UUID",
      date_time: "DateTime",
      bytes: "Bytes",
      file: "File"
    }

    setup ctx do
      metrics =
        for {{type, value}, i} <- Enum.with_index(@typed, 1) do
          [name: "Types/#{@names[type]}", type: type, value: value, alias: i, timestamp: @t0 + 1]
        end

      dbirth(ctx, birth(metrics))
      :ok
    end

    defp alias_of(type), do: Enum.find_index(@typed, &(elem(&1, 0) == type)) + 1

    # The value and Type a DATA metric of the birth's type is published
    # with.
    defp one(ctx, type, opts) do
      metric = Keyword.merge([alias: alias_of(type), type: type, timestamp: @t0 + 2], opts)

      case ddata(ctx, payload([metric], timestamp: @t0)) do
        [{_topic, payload, props}] ->
          {"Type", name} = List.keyfind(props, "Type", 0)
          %{"value" => _} = JSON.decode!(payload)
          [_, value] = Regex.run(~r/"value":(.*)}$/, payload)
          {value, name}

        [] ->
          nil
      end
    end

    # {description, datatype, metric options, JSON value}. A comment
    # gives what JS published, where it differs.
    @published [
      {"Int8 -1", :int8, [value: -1], "-1"},
      {"Int16 -300", :int16, [value: -300], "-300"},
      {"Int32 -5", :int32, [value: -5], "-5"},
      # JS: 18446744073709552000, from the unsigned bits.
      {"Int64 -5", :int64, [value: -5], "-5"},
      {"UInt8 255", :uint8, [value: 255], "255"},
      {"UInt16 65535", :uint16, [value: 65_535], "65535"},
      {"UInt32 4294967295", :uint32, [value: 4_294_967_295], "4294967295"},
      # JS: 9007199254740992, rounded.
      {"UInt64 2^53+1", :uint64, [value: 9_007_199_254_740_993], "9007199254740993"},
      {"Float 0.1", :float, [value: 0.1], "0.10000000149011612"},
      {"Double 5", :double, [value: 5.0], "5"},
      {"Boolean true", :boolean, [value: true], "true"},
      {"String", :string, [value: "s"], ~s("s")},
      {"Text", :text, [value: "t"], ~s("t")},
      {"UUID", :uuid, [value: "u"], ~s("u")},
      {"DateTime", :date_time, [value: @t0], "1792531570000"},
      {"Bytes", :bytes, [value: <<104, 105, 255>>], ~s({"type":"Buffer","data":[104,105,255]})},
      {"File", :file, [value: "f"], ~s({"type":"Buffer","data":[102]})},
      # JS: 255 and 65535.
      {"Int8 0xFF in int_value", :int8, [raw: {:int_value, 0xFF}], "-1"},
      {"Int16 0xFFFF in int_value", :int16, [raw: {:int_value, 0xFFFF}], "-1"},
      {"Int32 2^31-1", :int32, [value: 2_147_483_647], "2147483647"},
      # JS: 9007199254740992, 9223372036854776000 and 9223372036854776000.
      {"Int64 2^53+1", :int64, [value: 9_007_199_254_740_993], "9007199254740993"},
      {"Int64 2^63-1", :int64, [value: 9_223_372_036_854_775_807], "9223372036854775807"},
      {"Int64 -2^63", :int64, [value: -9_223_372_036_854_775_808], "-9223372036854775808"},
      {"UInt32 2^31", :uint32, [value: 2_147_483_648], "2147483648"},
      # JS dropped it: it only read long_value.
      {"UInt32 7 in int_value", :uint32, [raw: {:int_value, 7}], "7"},
      # JS: 18446744073709552000.
      {"UInt64 2^64-1", :uint64, [value: 18_446_744_073_709_551_615], "18446744073709551615"},
      {"Float NaN", :float, [value: :nan], "null"},
      {"Float Infinity", :float, [value: :infinity], "null"},
      {"Float 1.5", :float, [value: 1.5], "1.5"},
      {"Float 3e38", :float, [value: 3.0e38], "3.0000000054977558e+38"},
      {"Double 1e21", :double, [value: 1.0e21], "1e+21"},
      {"Double 1e20", :double, [value: 1.0e20], "100000000000000000000"},
      {"Double -0", :double, [value: -0.0], "0"},
      {"Double 1.5e-7", :double, [value: 1.5e-7], "1.5e-7"},
      {"Double 0.000001", :double, [value: 0.000001], "0.000001"},
      {"Double 5e-324", :double, [value: 5.0e-324], "5e-324"},
      {"Double 0.1+0.2", :double, [value: 0.1 + 0.2], "0.30000000000000004"},
      {"Boolean false", :boolean, [value: false], "false"},
      {"String empty", :string, [value: ""], ~s("")},
      {"String escapes", :string, [value: "q\" b\\ n\n t\t / " <> <<1, 31, 127>>],
       ~S("q\" b\\ n\n t\t / \u0001\u001f) <> <<127, ?">>},
      {"String unicode", :string, [value: "é ✓ 😀"], ~s("é ✓ 😀")},
      {"String with invalid UTF-8", :string, [raw: {:string_value, <<"a", 0xFF, "b">>}],
       ~s("a�b")},
      # JS skipped it: with no datatype its value was null.
      {"Double with no datatype", :double, [type: nil, raw: {:double_value, 7.5}], "7.5"},
      # JS: 0.
      {"Int32 in long_value", :int32, [raw: {:long_value, 42}], "42"}
    ]

    for {description, type, opts, value} <- @published do
      @datatype type
      @opts opts
      @value value

      test "DATA: #{description}", ctx do
        assert one(ctx, @datatype, @opts) == {@value, @names[@datatype]}
      end
    end

    # {description, datatype, metric options, log}. JS published these,
    # unless a comment says otherwise.
    @skipped [
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
      {"Template for a String", :string,
       [
         type: :template,
         raw:
           {:template_value,
            %Payload.Template{
              metrics: [%Payload.Metric{name: "x", datatype: 3, value: {:int_value, 1}}]
            }}
       ], "its DATA has datatype template, but its birth has datatype string"},
      # JS skipped it silently.
      {"Int8Array for a String", :string, [type: :int8_array, raw: {:bytes_value, <<1, 2>>}],
       "its DATA has datatype int8_array, but its birth has datatype string"},
      # JS: 1.5, with Type Int32.
      {"Double 1.5 for an Int32", :int32, [type: :double, value: 1.5],
       "its DATA has datatype double, but its birth has datatype int32"},
      {"String \"true\" for a Boolean", :boolean, [type: :string, value: "true"],
       "its DATA has datatype string, but its birth has datatype boolean"},
      {"Int8 300", :int8, [raw: {:int_value, 300}],
       ~s(its value, {:int_value, 300}, isn't valid for datatype int8)}
    ]

    for {description, type, opts, message} <- @skipped do
      @datatype type
      @opts opts
      @message message

      test "DATA skipped: #{description}", ctx do
        {result, log} = with_log(fn -> one(ctx, @datatype, @opts) end)
        assert result == nil
        assert log =~ @message
      end
    end

    test "DATA with no value is skipped silently", ctx do
      for opts <- [[raw: nil], [value: nil]] do
        {result, log} = with_log(fn -> one(ctx, :double, opts) end)
        assert result == nil
        assert log == ""
      end
    end

    test "a transient flag on DATA only doesn't change Transient", ctx do
      metric = [alias: alias_of(:double), type: :double, value: 2.0, transient: true]

      assert [{_, _, [_, _, {"Transient", "false"} | _]}] =
               ddata(ctx, payload([metric], timestamp: @t0))
    end
  end

  test "datatypes it doesn't publish are logged once, at the birth", ctx do
    template = %Payload.Template{metrics: [%Payload.Metric{name: "x", datatype: 3}]}

    birth =
      birth([
        [name: "T", type: :template, raw: {:template_value, template}, alias: 1],
        [name: "Arr", type: :int8_array, raw: {:bytes_value, <<1, 2>>}, alias: 2],
        [name: "V", type: :double, value: 1.0, alias: 3, timestamp: @t0 + 1]
      ])

    {messages, log} = with_log(fn -> dbirth(ctx, birth) end)
    assert List.last(messages) == {@prefix <> "V", json(1, "1"), props("Double")}

    assert log =~
             "Won't publish 2 metrics of G1/N1/D1 to the UNS, as it doesn't publish their " <>
               ~s(datatypes: "T" \(datatype template\), "Arr" \(datatype int8_array\))

    data =
      payload([[alias: 1, type: :template, raw: {:template_value, template}]], timestamp: @t0)

    {messages, log} = with_log([level: :debug], fn -> ddata(ctx, data) end)
    assert messages == []

    assert log =~
             ~s(Skipped "T" from G1/N1/D1: the UNS ingester doesn't publish datatype template)

    refute log =~ "Won't publish"
  end

  # JS crashed on each of these, as it only took a metric's own
  # timestamp.
  describe "timestamps" do
    setup ctx do
      metrics =
        tops() ++ hierarchy(Enterprise: "E") ++ [[name: "V", type: :double, value: 1.0, alias: 1]]

      before = UnsPayload.iso8601(System.os_time(:nanosecond))

      {[_, {"UNS/v1/E/Edge/D1/V", birth, _}], _} =
        with_log(fn -> dbirth(ctx, fplus_payload(metrics)) end)

      %{birth: birth, before: before}
    end

    defp timestamp(ctx, metric, opts) do
      data = payload([[alias: 1, type: :double, value: 2.0] ++ metric], opts)
      [{_topic, payload, _}] = ddata(ctx, data)
      JSON.decode!(payload)["timestamp"]
    end

    test "are the metric's, else the payload's, else when it arrived", ctx do
      assert timestamp(ctx, [timestamp: @ns], timestamp: @t0) == "2026-10-20T21:26:10.123456789Z"
      assert timestamp(ctx, [timestamp: @t0 + 1], timestamp: @t0 + 5) == at(1)
      assert timestamp(ctx, [], timestamp: @t0 + 7) == at(7)

      # The same format throughout, so the strings sort as the times do.
      before = UnsPayload.iso8601(System.os_time(:nanosecond))
      assert timestamp(ctx, [], []) >= before
    end

    test "a birth with no timestamps publishes when it arrived", ctx do
      assert JSON.decode!(ctx.birth)["timestamp"] >= ctx.before
    end

    test "below 10^15 are milliseconds", ctx do
      assert timestamp(ctx, [timestamp: 0], []) == "1970-01-01T00:00:00.000000000Z"

      assert timestamp(ctx, [timestamp: 999_999_999_999_999], []) ==
               "+033658-09-27T01:46:39.999000000Z"

      assert timestamp(ctx, [timestamp: 1_000_000_000_000_000], []) ==
               "1970-01-12T13:46:40.000000000Z"

      assert timestamp(ctx, [timestamp: 18_446_744_073_709_551_615], []) ==
               "2554-07-21T23:34:33.709551615Z"
    end
  end

  describe "simulated data" do
    setup ctx do
      dbirth(ctx, birth([[name: "V", type: :double, value: 1.0, alias: 1, timestamp: @t0 + 1]]))
      :ok
    end

    defp marked(ctx, properties) do
      metric = [alias: 1, type: :double, value: 2.0, timestamp: @t0 + 2, properties: properties]
      [{_topic, _payload, props}] = ddata(ctx, payload([metric], timestamp: @t0))
      Enum.drop(props, 7)
    end

    test "is marked as in the JS", ctx do
      assert marked(ctx, simulated: {:boolean, true}, run_id: {:string, "r1"}) ==
               [{"Simulated", "true"}, {"RunId", "r1"}]

      assert marked(ctx, simulated: {:boolean, true}, run_id: {:uint64, 42}) ==
               [{"Simulated", "true"}, {"RunId", "42"}]

      assert marked(ctx, simulated: {:boolean, true}) == [{"Simulated", "true"}]
      assert marked(ctx, simulated: {:boolean, false}, run_id: {:string, "r2"}) == []
      # Truthy as JS sees it.
      assert marked(ctx, simulated: {:string, "no"}) == [{"Simulated", "true"}]
      assert marked(ctx, engUnit: {:string, "kPa"}) == []
    end

    test "comes from a topic's first sample", ctx do
      data =
        payload(
          [
            [alias: 1, type: :double, value: 7.0, timestamp: @t0 + 3],
            [
              alias: 1,
              type: :double,
              value: 8.0,
              timestamp: @t0 + 4,
              properties: [simulated: {:boolean, true}]
            ]
          ],
          timestamp: @t0
        )

      assert [{_topic, _payload, props}] = ddata(ctx, data)
      refute List.keymember?(props, "Simulated", 0)
    end
  end

  # JS keyed every metric without an alias as "undefined", so the last
  # one's topic took all their values.
  test "a birth without aliases is resolved by name", ctx do
    birth =
      fplus_payload(
        Enum.map(tops() ++ hierarchy(Enterprise: "E"), &Keyword.delete(&1, :alias)) ++
          [
            [name: "A/First", type: :double, value: 1.0, timestamp: @t0 + 1],
            [name: "A/Second", type: :string, value: "two", timestamp: @t0 + 1]
          ],
        timestamp: @t0
      )

    assert Enum.map(dbirth(ctx, birth), &elem(&1, 0)) == [
             "UNS/v1/E/Edge/D1/Device_Information/ISA95_Hierarchy/Enterprise",
             "UNS/v1/E/Edge/D1/A/First",
             "UNS/v1/E/Edge/D1/A/Second"
           ]

    data =
      payload([[name: "A/First", type: :double, value: 5.0, timestamp: @t0 + 2]], timestamp: @t0)

    assert ddata(ctx, data) == [{"UNS/v1/E/Edge/D1/A/First", json(2, "5"), props("Double")}]
  end

  # JS published these, to topics MQTT doesn't allow.
  test "a metric whose topic MQTT forbids is skipped", ctx do
    birth =
      birth([
        [name: "A/+/B", type: :double, value: 1.0, alias: 1, timestamp: @t0 + 1],
        [name: "A/#", type: :double, value: 1.0, alias: 2, timestamp: @t0 + 1],
        [
          name: String.duplicate("x", 65_536),
          type: :double,
          value: 1.0,
          alias: 3,
          timestamp: @t0 + 1
        ],
        [name: "A/B", type: :double, value: 1.0, alias: 4, timestamp: @t0 + 1]
      ])

    {messages, log} = with_log(fn -> dbirth(ctx, birth) end)
    assert List.last(messages) == {@prefix <> "A/B", json(1, "1"), props("Double")}
    assert length(messages) == 6
    assert log =~ ~s(Won't publish "A/+/B" from G1/N1/D1 to the UNS: its topic would have +, #)
    assert log =~ ~s(Won't publish "A/#" from G1/N1/D1)
    assert log =~ "its topic is over 65535 bytes"
  end

  test "node births and node data are ignored", ctx do
    birth = payload([[name: "X", type: :double, value: 1.0, alias: 1]], timestamp: @t0)
    assert messages(ctx, "spBv1.0/G1/NBIRTH/N1", birth) == []
  end

  describe "handle_update/2" do
    setup ctx do
      metrics =
        tops() ++
          hierarchy(Enterprise: "E") ++
          [[name: "V", type: :double, value: 1.0, alias: 1, timestamp: @t0 + 1]]

      send(ctx.router, {:fplus_mqtt, "spBv1.0/G1/DBIRTH/N1/D1", fplus_payload(metrics), %{}})
      assert_receive {:update, update}
      %{update: update}
    end

    test "publishes each message", %{update: update} do
      test = self()

      publish = fn topic, payload, props ->
        send(test, {:published, topic, payload, props})
        :ok
      end

      log = capture_log(fn -> UnsIngester.handle_update(update, publish: publish) end)
      refute log =~ "Couldn't publish"

      assert_received {:published,
                       "UNS/v1/E/Edge/D1/Device_Information/ISA95_Hierarchy/Enterprise", _, _}

      assert_received {:published, "UNS/v1/E/Edge/D1/V", ~s({"timestamp":) <> _,
                       [{"InstanceUUID", "i-top"} | _]}
    end

    test "logs what it couldn't publish", %{update: update} do
      log =
        capture_log(fn ->
          UnsIngester.handle_update(update, publish: fn _, _, _ -> {:error, :not_connected} end)
        end)

      assert log =~ "Couldn't publish 2 of 2 UNS messages for G1/N1/D1: {:error, :not_connected}"
    end
  end
end
