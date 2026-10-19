# ACS Service Client
# Checks that the dependencies build as intended
# Copyright 2026 University of Sheffield

defmodule FPlusTest do
  use ExUnit.Case, async: true

  test "emqtt loads, built without QUIC" do
    # quicer is a stub, so emqtt must not need it.
    assert {:module, :emqtt} = Code.ensure_loaded(:emqtt)
    refute Code.ensure_loaded?(:quicer)
  end

  test "kerlberos is the in-tree fork" do
    source = :krb_auth_fsm.module_info(:compile)[:source] |> List.to_string()

    assert source =~ "lib/erl-kerlberos/src/krb_auth_fsm.erl"
  end

  test "the Sparkplug library is available" do
    assert {:ok, %SparkplugB.Topic{type: :ndata}} =
             SparkplugB.Topic.parse("spBv1.0/Site_1/NDATA/Edge_1")
  end
end
