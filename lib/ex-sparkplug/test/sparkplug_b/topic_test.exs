# ACS Sparkplug B
# Tests for Sparkplug topic names
# Copyright 2026 University of Sheffield

defmodule SparkplugB.TopicTest do
  use ExUnit.Case, async: true

  alias SparkplugB.Topic

  doctest Topic

  describe "parse/1" do
    test "reads every node message type" do
      for {type, wire} <- [nbirth: "NBIRTH", ndeath: "NDEATH", ndata: "NDATA", ncmd: "NCMD"] do
        assert Topic.parse("spBv1.0/Site_1/#{wire}/Edge_1") ==
                 {:ok, %Topic{type: type, group: "Site_1", node: "Edge_1"}}
      end
    end

    test "reads every device message type" do
      for {type, wire} <- [dbirth: "DBIRTH", ddeath: "DDEATH", ddata: "DDATA", dcmd: "DCMD"] do
        assert Topic.parse("spBv1.0/Site_1/#{wire}/Edge_1/Pump_3") ==
                 {:ok, %Topic{type: type, group: "Site_1", node: "Edge_1", device: "Pump_3"}}
      end
    end

    test "reads both forms of host state" do
      assert Topic.parse("spBv1.0/STATE/historian") ==
               {:ok, %Topic{type: :state, host: "historian"}}

      assert Topic.parse("STATE/historian") ==
               {:ok, %Topic{type: :legacy_state, host: "historian"}}
    end

    test "keeps IDs with spaces, dots and non-ASCII characters" do
      assert {:ok, %Topic{group: "Bay 4.2", node: "Pressé"}} =
               Topic.parse("spBv1.0/Bay 4.2/NDATA/Pressé")
    end

    test "rejects topics that aren't Sparkplug B" do
      for topic <- [
            "",
            "spBv1.0",
            "spAv1.0/Site_1/NDATA/Edge_1",
            "UNS/v1/Site_1/Edge_1",
            "spBv1.0/Site_1/NFOO/Edge_1",
            "spBv1.0/Site_1/ndata/Edge_1",
            "spBv1.0/STATE",
            "spBv1.0/STATE/historian/extra",
            "spBv1.0/Site_1/NDATA/Edge_1/extra",
            "spBv1.0/Site_1/DDATA/Edge_1",
            "spBv1.0/Site_1/DDATA/Edge_1/Pump_3/extra"
          ] do
        assert Topic.parse(topic) == {:error, :invalid_topic}, "accepted #{inspect(topic)}"
      end
    end

    test "rejects empty and invalid IDs" do
      for topic <- [
            "spBv1.0//NDATA/Edge_1",
            "spBv1.0/Site_1/NDATA/",
            "spBv1.0/Site_1/DDATA/Edge_1/",
            "spBv1.0/STATE/",
            "spBv1.0/Site_+/NDATA/Edge_1",
            "spBv1.0/Site_1/NDATA/Edge_#",
            "spBv1.0/Site_1/NDATA/" <> <<0xFF>>
          ] do
        assert Topic.parse(topic) == {:error, :invalid_topic}, "accepted #{inspect(topic)}"
      end
    end
  end

  describe "to_string/1" do
    test "gives back the topic it was parsed from" do
      for topic <- [
            "spBv1.0/Site_1/NBIRTH/Edge_1",
            "spBv1.0/Site_1/DCMD/Edge_1/Pump_3",
            "spBv1.0/STATE/historian",
            "STATE/historian"
          ] do
        {:ok, parsed} = Topic.parse(topic)
        assert Topic.to_string(parsed) == topic
      end
    end

    test "works through string interpolation" do
      topic = %Topic{type: :ddata, group: "Site_1", node: "Edge_1", device: "Pump_3"}

      assert "#{topic}" == "spBv1.0/Site_1/DDATA/Edge_1/Pump_3"
    end
  end
end
