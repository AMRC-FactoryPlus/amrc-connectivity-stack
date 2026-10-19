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
  end

  test "unsigned integers are accepted from either integer field" do
    assert %Metric{value: 7} = decode_metric(%Proto.Metric{datatype: 7, value: {:int_value, 7}})
    assert %Metric{value: 7} = decode_metric(%Proto.Metric{datatype: 7, value: {:long_value, 7}})
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
