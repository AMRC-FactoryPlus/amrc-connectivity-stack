# ACS Ingest
# Tests for the InfluxDB line protocol encoder
# Copyright 2026 University of Sheffield

defmodule Ingest.LineProtocolTest do
  use ExUnit.Case, async: true

  alias Ingest.LineProtocol

  doctest LineProtocol

  @max_time 0x7FFFFFFFFFFFFFFF - 1
  @min_time -0x8000000000000000 + 2

  defp line(measurement, tags, fields, timestamp \\ 1) do
    case LineProtocol.encode(measurement, tags, fields, timestamp) do
      {:ok, line} -> IO.iodata_to_binary(line)
      error -> error
    end
  end

  defp value(value), do: line("m", %{}, %{"value" => value})

  describe "matches what @influxdata/influxdb-client 1.33.2 writes" do
    test "for a plain point" do
      tags = %{"device" => "Motor1", "group" => "Plant"}

      assert line("Speed:d", tags, %{"value" => {:float, 1.5}}, 1_700_000_000_000_000_000) ==
               "Speed:d,device=Motor1,group=Plant value=1.5 1700000000000000000\n"
    end

    test "escaping measurements" do
      assert line("a b,c=d\"e\\f\ng\rh\ti:s", %{}, %{"value" => {:string, "x"}}) ==
               ~S(a\ b\,c=d"e\f\ng\rh\ti:s value="x" 1) <> "\n"
    end

    test "escaping tag keys and values" do
      tags = %{"k ,=\n\r\tk" => "a b,c=d\ne\rf\tg\\h\"i"}

      assert line("m", tags, %{"value" => {:integer, 1}}) ==
               ~S(m,k\ \,\=\n\r\tk=a\ b\,c\=d\ne\rf\tg\h"i value=1i 1) <> "\n"
    end

    test "escaping field keys" do
      assert line("m", %{}, %{"v a,l=u\ne" => {:integer, 1}}) ==
               ~S(m v\ a\,l\=u\ne=1i 1) <> "\n"
    end

    test "escaping string values" do
      assert value({:string, "say \"hi\" \\ C:\\path\nnext\tline"}) ==
               ~S(m value="say \"hi\" \\ C:\\path) <> "\nnext\tline\" 1\n"
    end

    test "sorting tags and fields by key" do
      tags = %{"path" => "Axes/1", "B" => "1", "_x" => "2", "a" => "3", "device" => "D"}
      fields = %{"z" => {:integer, 1}, "b" => {:boolean, true}, "a" => {:boolean, false}}

      assert line("m", tags, fields) ==
               "m,B=1,_x=2,a=3,device=D,path=Axes/1 a=F,b=T,z=1i 1\n"
    end

    test "leaving out empty tags" do
      tags = %{"a" => "", "b" => nil, "d" => "x"}

      assert line("m", tags, %{"value" => {:integer, -5}}, 0) == "m,d=x value=-5i 0\n"
    end

    test "for a historian point, apart from the float's text" do
      tags = %{
        "path" => "Phases/10",
        "usesSchemas" => "s-top:s-ph1",
        "unit" => "V ac",
        "device" => "Power Meter"
      }

      # The JS client writes 231.
      assert line("Voltage:d", tags, %{"value" => {:float, 231.0}}, 1_700_000_000_123_456_789) ==
               ~S(Voltage:d,device=Power\ Meter,path=Phases/10,unit=V\ ac,usesSchemas=s-top:s-ph1 value=231.0 1700000000123456789) <>
                 "\n"
    end

    test "for Unicode" do
      tags = %{"unit" => "°C", "ключ" => "значение"}

      assert line("Température:s", tags, %{"value" => {:string, "∆ 🚀"}}) ==
               ~s(Température:s,unit=°C,ключ=значение value="∆ 🚀" 1\n)
    end
  end

  describe "field types" do
    test "integers, across int64" do
      assert value({:integer, 0}) == "m value=0i 1\n"
      assert value({:integer, -9_223_372_036_854_775_808}) == "m value=-9223372036854775808i 1\n"
      assert value({:integer, 9_223_372_036_854_775_807}) == "m value=9223372036854775807i 1\n"
    end

    test "unsigned integers, across uint64" do
      assert value({:unsigned, 0}) == "m value=0u 1\n"
      assert value({:unsigned, 9_223_372_036_854_775_808}) == "m value=9223372036854775808u 1\n"
      assert value({:unsigned, 18_446_744_073_709_551_615}) == "m value=18446744073709551615u 1\n"
    end

    test "floats, as their shortest round trip" do
      assert value({:float, 5.0}) == "m value=5.0 1\n"
      assert value({:float, -2.5}) == "m value=-2.5 1\n"
      assert value({:float, 0.1}) == "m value=0.1 1\n"
      assert value({:float, 1.0e21}) == "m value=1.0e21 1\n"
      assert value({:float, 1.5e-7}) == "m value=1.5e-7 1\n"
      assert value({:float, -1.0e308}) == "m value=-1.0e308 1\n"
    end

    test "negative zero, as zero, like the JS client" do
      assert value({:float, -0.0}) == "m value=0.0 1\n"
      assert value({:float, 0.0}) == "m value=0.0 1\n"
    end

    test "booleans" do
      assert value({:boolean, true}) == "m value=T 1\n"
      assert value({:boolean, false}) == "m value=F 1\n"
    end

    test "strings" do
      assert value({:string, ""}) == ~s(m value="" 1\n)
      assert value({:string, "Phases/1, Voltage = 3"}) == ~s(m value="Phases/1, Voltage = 3" 1\n)
    end

    test "raise when the value isn't the type it's tagged with" do
      for bad <- [{:integer, 1.0}, {:unsigned, "1"}, {:float, 1}, {:boolean, nil}, {:string, 1}] do
        assert_raise FunctionClauseError, fn -> value(bad) end
      end
    end
  end

  describe "measurements and tags" do
    test "are sorted however many tags there are" do
      # Maps of up to 32 keys already iterate in key order.
      keys = for n <- 1..40, do: "t#{String.pad_leading("#{n}", 2, "0")}"
      tags = Map.new(keys, &{&1, "v"})

      assert line("m", tags, %{"value" => {:integer, 1}}) ==
               "m#{Enum.map_join(keys, &",#{&1}=v")} value=1i 1\n"
    end

    test "keep slashes, colons and other punctuation" do
      tags = %{"path" => "Axes/1/Base Axis", "usesInstances" => "i-top:"}

      assert line("Phases/1 Voltage:d", tags, %{"value" => {:float, 1.5}}) ==
               ~S(Phases/1\ Voltage:d,path=Axes/1/Base\ Axis,usesInstances=i-top: value=1.5 1) <>
                 "\n"
    end

    test "write other backslashes as they are" do
      assert line("a\\b=c:s", %{"dir" => "C:\\data\\x"}, %{"value" => {:integer, 1}}) ==
               ~S(a\b=c:s,dir=C:\data\x value=1i 1) <> "\n"
    end

    test "allow # after the start of a measurement" do
      assert line("Count#1:i", %{}, %{"value" => {:integer, 1}}) == "Count#1:i value=1i 1\n"
    end
  end

  describe "refuses points InfluxDB would reject or misread" do
    test "integers out of range" do
      assert value({:integer, 9_223_372_036_854_775_808}) ==
               {:error, ~s(field "value" is outside int64)}

      assert value({:integer, -9_223_372_036_854_775_809}) ==
               {:error, ~s(field "value" is outside int64)}

      assert value({:unsigned, -1}) == {:error, ~s(field "value" is outside uint64)}

      assert value({:unsigned, 18_446_744_073_709_551_616}) ==
               {:error, ~s(field "value" is outside uint64)}
    end

    test "NaN and infinities" do
      assert value({:float, :nan}) == {:error, ~s(field "value" is NaN)}
      assert value({:float, :infinity}) == {:error, ~s(field "value" is infinite)}
      assert value({:float, :"-infinity"}) == {:error, ~s(field "value" is infinite)}
    end

    test "timestamps outside 1677 to 2262" do
      fields = %{"value" => {:integer, 1}}

      assert line("m", %{}, fields, @max_time) == "m value=1i #{@max_time}\n"
      assert line("m", %{}, fields, @min_time) == "m value=1i #{@min_time}\n"

      for ns <- [@max_time + 1, @min_time - 1, 0x10000000000000000] do
        assert line("m", %{}, fields, ns) == {:error, "timestamp is outside InfluxDB's range"}
      end
    end

    test "backslashes InfluxDB would read as escaping our escapes" do
      fields = %{"value" => {:integer, 1}}
      problem = "has a backslash at the end or before a character that needs escaping"

      for name <- ["a\\", "a\\ b", "a\\,b", "a\\\tb"] do
        assert line(name, %{}, fields) == {:error, "measurement #{problem}"}
      end

      for value <- ["a\\", "a\\ b", "a\\,b", "a\\=b", "a\\\nb"] do
        assert line("m", %{"t" => value}, fields) == {:error, ~s(tag "t" #{problem})}

        assert line("m", %{value => "v"}, fields) ==
                 {:error, "tag key #{inspect(value)} #{problem}"}

        assert line("m", %{}, %{value => {:integer, 1}}) ==
                 {:error, "field key #{inspect(value)} #{problem}"}
      end
    end

    test "a measurement starting with #, which InfluxDB reads as a comment" do
      assert line("#count:i", %{}, %{"value" => {:integer, 1}}) ==
               {:error, "measurement starts with #, so InfluxDB would read the line as a comment"}
    end

    test "series keys longer than InfluxDB allows" do
      fields = %{"value" => {:integer, 1}}
      long = String.duplicate("x", 60_000)

      assert {:ok, _} = LineProtocol.encode("m", %{"t" => long}, fields, 1)

      assert line("m", %{"t" => long, "u" => String.duplicate("y", 5_536)}, fields) ==
               {:error, "series key is longer than InfluxDB allows"}

      assert line("m", %{"t" => long}, %{String.duplicate("v", 5_536) => {:integer, 1}}) ==
               {:error, "series key is longer than InfluxDB allows"}
    end

    test "empty names and no fields" do
      fields = %{"value" => {:integer, 1}}

      assert line("", %{}, fields) == {:error, "measurement is empty"}
      assert line("m", %{"" => "v"}, fields) == {:error, "tag key is empty"}
      assert line("m", %{}, %{"" => {:integer, 1}}) == {:error, "field key is empty"}
      assert line("m", %{"t" => "v"}, %{}) == {:error, "point has no fields"}
    end
  end
end
