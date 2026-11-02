# ACS Ingest
# Tests for the JS semantics the ported services depend on
# Copyright 2026 University of Sheffield

defmodule Ingest.JSTest do
  use ExUnit.Case, async: true

  alias Ingest.JS

  doctest JS

  test "truthy?/1 is JS's truthiness" do
    for value <- [nil, false, "", 0, 0.0, -0.0, :nan], do: refute(JS.truthy?(value))
    for value <- [true, "false", "no", "0", 1, -1, 0.5, :infinity], do: assert(JS.truthy?(value))
  end

  test "string/1 is JS's String(), for strings, numbers and booleans" do
    assert JS.string("s") == {:ok, "s"}
    assert JS.string(5) == {:ok, "5"}
    assert JS.string(1.5) == {:ok, "1.5"}
    assert JS.string(:nan) == {:ok, "NaN"}
    assert JS.string(true) == {:ok, "true"}
    assert JS.string({:int_value, 300}) == :error
    assert JS.string(%{}) == :error
  end
end
