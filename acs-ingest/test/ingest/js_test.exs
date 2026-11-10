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

  test "trim/1 strips what JS's trim() strips" do
    spaces = " \t\n\v\f\r\u00A0\u1680\u2000\u2005\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF"
    assert JS.trim(spaces <> "a b" <> spaces) == "a b"
    assert JS.trim(spaces) == ""
    assert JS.trim("") == ""
    assert JS.trim("é") == "é"

    # Unicode counts U+0085 and U+180E as white space, or once did; JS
    # doesn't strip them.
    assert JS.trim("\u0085a\u180E") == "\u0085a\u180E"
    assert JS.trim(<<0xFF, ?\s>>) == <<0xFF>>
  end
end
