# ACS Service Client
# Tests for MQTT topic filters
# Copyright 2026 University of Sheffield

defmodule FPlus.MQTT.FilterTest do
  use ExUnit.Case, async: true

  alias FPlus.MQTT.Filter

  doctest Filter

  test "valid filters" do
    for filter <- ["#", "+", "a/b", "a/+/c", "a/#", "+/+", "spBv1.0/STATE/+", "/a", "a//b"] do
      assert Filter.valid?(filter), "rejected #{inspect(filter)}"
    end
  end

  test "invalid filters" do
    for filter <- ["", "a/#/b", "a#", "a/b#", "a+", "+a/b", "#/a", <<0xFF>>] do
      refute Filter.valid?(filter), "accepted #{inspect(filter)}"
    end
  end

  test "matching" do
    matches = [
      {"a/b", "a/b"},
      {"a/+", "a/b"},
      {"+/b", "a/b"},
      {"a/#", "a/b/c"},
      {"a/#", "a"},
      {"#", "a/b/c"},
      {"+/+", "/a"},
      {"spBv1.0/+/DDATA/+/+", "spBv1.0/Site_1/DDATA/Edge_1/Pump 3"}
    ]

    for {filter, topic} <- matches do
      assert Filter.match?(filter, topic), "#{filter} didn't match #{topic}"
    end
  end

  test "not matching" do
    misses = [
      {"a/b", "a/c"},
      {"a/+", "a/b/c"},
      {"a/+", "a"},
      {"+", "a/b"},
      {"a/b", "a/b/c"},
      {"#", "$SYS/uptime"},
      {"+/uptime", "$SYS/uptime"}
    ]

    for {filter, topic} <- misses do
      refute Filter.match?(filter, topic), "#{filter} matched #{topic}"
    end

    assert Filter.match?("$SYS/#", "$SYS/uptime")
  end
end
