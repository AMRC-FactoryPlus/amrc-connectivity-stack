# ACS Sparkplug B
# Tests for decoding metric values
# Copyright 2026 University of Sheffield

defmodule SparkplugB.MetricTest do
  use ExUnit.Case, async: true

  alias SparkplugB.Metric
  alias SparkplugB.Property
  alias SparkplugB.Proto.Org.Eclipse.Tahu.Protobuf.Payload, as: Proto

  # Encode a metric with protox, as a non-Tahu encoder might, and decode
  # it again.
  defp decode_metric(metric) do
    {:ok, iodata, _size} = Protox.encode(%Proto{metrics: [metric]})
    {:ok, payload} = SparkplugB.decode(IO.iodata_to_binary(iodata))
    hd(payload.metrics)
  end

  describe "a metric without a datatype" do
    test "keeps its raw value" do
      metric = decode_metric(%Proto.Metric{alias: 1, value: {:long_value, 42}})

      assert %Metric{datatype: nil, value: {:long_value, 42}} = metric
    end

    test "is converted by with_datatype/2 using the birth's datatype" do
      metric = decode_metric(%Proto.Metric{alias: 1, value: {:int_value, 4_294_967_291}})

      assert %Metric{datatype: :int32, value: -5} = Metric.with_datatype(metric, :int32)
    end

    test "stays null through with_datatype/2" do
      metric = decode_metric(%Proto.Metric{alias: 1, is_null: true})

      assert %Metric{datatype: :double, value: nil} = Metric.with_datatype(metric, :double)
    end
  end

  test "with_datatype/2 leaves a metric that has a datatype alone" do
    metric = decode_metric(%Proto.Metric{alias: 1, datatype: 10, value: {:double_value, 1.5}})

    assert Metric.with_datatype(metric, :int8) == metric
  end

  describe "signed integers" do
    test "decode from the field's width or the type's own" do
      # Tahu JS sends Int8 -5 as 32-bit two's complement; an encoder
      # using the type's width sends 251.
      for raw <- [4_294_967_291, 251] do
        assert %Metric{value: -5} =
                 decode_metric(%Proto.Metric{datatype: 1, value: {:int_value, raw}})
      end

      assert %Metric{value: -300} =
               decode_metric(%Proto.Metric{datatype: 2, value: {:int_value, 65_236}})

      assert %Metric{value: -1} =
               decode_metric(%Proto.Metric{
                 datatype: 4,
                 value: {:long_value, 18_446_744_073_709_551_615}
               })
    end

    test "keep positive values" do
      assert %Metric{value: 127} =
               decode_metric(%Proto.Metric{datatype: 1, value: {:int_value, 127}})

      assert %Metric{value: 9_223_372_036_854_775_807} =
               decode_metric(%Proto.Metric{
                 datatype: 4,
                 value: {:long_value, 9_223_372_036_854_775_807}
               })
    end

    test "decode from sign extension to 32 or 64 bits in either field" do
      for {datatype, raw, value} <- [
            {1, {:long_value, 4_294_967_168}, -128},
            {1, {:long_value, 18_446_744_073_709_551_488}, -128},
            {2, {:long_value, 4_294_934_528}, -32_768},
            {3, {:long_value, 18_446_744_071_562_067_968}, -2_147_483_648},
            {3, {:int_value, 2_147_483_648}, -2_147_483_648}
          ] do
        assert %Metric{value: ^value} =
                 decode_metric(%Proto.Metric{datatype: datatype, value: raw})
      end
    end

    test "out of range for their type stay raw" do
      for {datatype, raw} <- [
            # Too big for the type's width.
            {1, {:int_value, 300}},
            {2, {:int_value, 65_536}},
            {3, {:long_value, 4_294_967_296}},
            # One below the type's minimum, sign-extended.
            {1, {:int_value, 4_294_967_167}},
            {1, {:long_value, 18_446_744_073_709_551_487}},
            {2, {:long_value, 4_294_934_527}},
            {3, {:long_value, 18_446_744_071_562_067_967}},
            # Neither the type's width nor sign extension.
            {1, {:long_value, 9_223_372_036_854_775_808}}
          ] do
        assert %Metric{value: ^raw} = decode_metric(%Proto.Metric{datatype: datatype, value: raw})
      end
    end
  end

  describe "unsigned integers" do
    test "are accepted from either integer field" do
      assert %Metric{value: 7} = decode_metric(%Proto.Metric{datatype: 7, value: {:int_value, 7}})

      assert %Metric{value: 7} =
               decode_metric(%Proto.Metric{datatype: 7, value: {:long_value, 7}})
    end

    test "decode up to their type's maximum" do
      for {datatype, value} <- [
            {5, 255},
            {6, 65_535},
            {7, 4_294_967_295},
            {8, 18_446_744_073_709_551_615}
          ] do
        assert %Metric{value: ^value} =
                 decode_metric(%Proto.Metric{datatype: datatype, value: {:long_value, value}})
      end
    end

    test "out of range for their type stay raw" do
      for {datatype, raw} <- [
            {5, {:int_value, 256}},
            {6, {:int_value, 65_536}},
            {7, {:long_value, 4_294_967_296}}
          ] do
        assert %Metric{value: ^raw} = decode_metric(%Proto.Metric{datatype: datatype, value: raw})
      end
    end
  end

  test "with_datatype/2 checks the range too" do
    metric = decode_metric(%Proto.Metric{alias: 1, value: {:int_value, 300}})

    assert %Metric{datatype: :int8, value: {:int_value, 300}} =
             Metric.with_datatype(metric, :int8)

    assert %Metric{datatype: :int16, value: 300} = Metric.with_datatype(metric, :int16)
  end

  test "a value in the wrong field for its datatype stays raw" do
    assert %Metric{datatype: :double, value: {:int_value, 3}} =
             decode_metric(%Proto.Metric{datatype: 10, value: {:int_value, 3}})
  end

  test "an unknown datatype stays an integer, with a raw value" do
    assert %Metric{datatype: 99, value: {:long_value, 3}} =
             decode_metric(%Proto.Metric{datatype: 99, value: {:long_value, 3}})
  end

  test "datatypes not converted yet keep their raw value" do
    data_set = %Proto.DataSet{num_of_columns: 1, columns: ["a"], types: [10]}

    assert %Metric{datatype: :data_set, value: {:dataset_value, %Proto.DataSet{}}} =
             decode_metric(%Proto.Metric{datatype: 16, value: {:dataset_value, data_set}})
  end

  test "nested property sets decode to maps" do
    inner = %Proto.PropertySet{
      keys: ["unit"],
      values: [%Proto.PropertyValue{type: 12, value: {:string_value, "V"}}]
    }

    properties = %Proto.PropertySet{
      keys: ["meta", "nothing"],
      values: [
        %Proto.PropertyValue{type: 20, value: {:propertyset_value, inner}},
        %Proto.PropertyValue{type: 10, is_null: true}
      ]
    }

    metric = decode_metric(%Proto.Metric{alias: 1, properties: properties})

    assert metric.properties == %{
             "meta" => %Property{
               datatype: :property_set,
               value: %{"unit" => %Property{datatype: :string, value: "V"}}
             },
             "nothing" => %Property{datatype: :double, value: nil}
           }
  end

  test "metadata decodes to a map of the fields present" do
    metadata = %Proto.MetaData{content_type: "text/plain", size: 12}
    metric = decode_metric(%Proto.Metric{alias: 1, metadata: metadata})

    assert metric.metadata == %{content_type: "text/plain", size: 12}
  end
end
