# ACS Ingest
# Tests for the Sparkplug path against the acs-local cluster
# Copyright 2026 University of Sheffield

defmodule Ingest.SparkplugACSLocalTest do
  # Needs the acs-local cluster, edge devices publishing on it, and the
  # sv1warehouse keytab; see the README.

  use ExUnit.Case, async: false

  alias Ingest.Sparkplug.Update

  @moduletag :acs_local
  @moduletag :capture_log
  @moduletag timeout: 180_000

  @fplus Ingest.SparkplugACSLocalTest.FPlus

  test "asks devices it doesn't know to rebirth, and resolves their data" do
    keytab = System.get_env("ACS_LOCAL_KEYTAB") || flunk("set ACS_LOCAL_KEYTAB; see the README")

    env = %{"DIRECTORY_URL" => "http://directory.acs.localhost/", "CLIENT_KEYTAB" => keytab}

    start_supervised!(
      {FPlus, [name: @fplus, kdc: [{"127.0.0.1", 88}]] ++ FPlus.opts_from_env(env)}
    )

    test = self()

    rebirth = fn address ->
      result = FPlus.CmdEsc.rebirth(FPlus.http(@fplus), address)
      send(test, {:rebirth, address, result})
      result
    end

    start_supervised!(
      {Ingest.Sparkplug,
       name: Ingest.SparkplugACSLocalTest.Sparkplug,
       subscribe: &FPlus.MQTT.subscribe(FPlus.mqtt(@fplus), &1),
       rebirth: rebirth,
       consumers: [{Ingest.Test.Consumer, pid: test}]}
    )

    # Everything is unknown at first, so the first DATA asks for a
    # rebirth, and the birth that answers lets later DATA resolve.
    assert_receive {:rebirth, address, :ok}, 90_000
    assert_receive {:update, %Update{kind: :birth, address: ^address}}, 30_000

    assert_receive {:update, %Update{kind: :data, address: ^address, metrics: metrics}}, 60_000
    assert metrics != []
    assert Enum.all?(metrics, fn {metric, meta} -> metric.name == meta.name end)
  end
end
