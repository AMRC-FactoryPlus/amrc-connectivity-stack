# ACS Ingest
# Tests for the whole service against the acs-local cluster
# Copyright 2026 University of Sheffield

defmodule IngestACSLocalTest do
  # Needs the acs-local cluster and the sv1warehouse keytab; see the
  # README.

  use ExUnit.Case, async: false

  @moduletag :acs_local
  @moduletag :capture_log

  defp wait_until(fun, tries \\ 300) do
    cond do
      fun.() -> :ok
      tries == 0 -> flunk("timed out waiting")
      true -> Process.sleep(100) && wait_until(fun, tries - 1)
    end
  end

  test "starts from the environment and connects to the broker" do
    keytab = System.get_env("ACS_LOCAL_KEYTAB") || flunk("set ACS_LOCAL_KEYTAB; see the README")

    {:ok, config} =
      Ingest.Config.from_env(%{
        "DIRECTORY_URL" => "http://directory.acs.localhost/",
        "CLIENT_KEYTAB" => keytab,
        "SPARKPLUG_HISTORIAN" => "true",
        "INFLUX_URL" => "http://influxdb.acs.localhost",
        "INFLUX_ORG" => "default",
        "INFLUX_TOKEN" => "unused"
      })

    # The KDC comes from :kdc here, as kerlberos reads a realm's config
    # once per VM.
    config = %{config | fplus: config.fplus ++ [kdc: [{"127.0.0.1", 88}]]}
    start_supervised!({Ingest, config})

    mqtt = FPlus.mqtt(Ingest.FPlus)
    wait_until(fn -> FPlus.MQTT.status(mqtt).connected end)

    assert %{broker: "mqtt.acs.localhost:1883"} = FPlus.MQTT.status(mqtt)
    assert Process.whereis(Ingest.Sparkplug)
    # The historian's points can't be written with a dummy token.
    assert %{written: 0} = Ingest.Writer.stats(Ingest.Writers.Sparkplug)
  end
end
