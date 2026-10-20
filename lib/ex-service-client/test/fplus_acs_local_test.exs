# ACS Service Client
# Tests for the whole client against the acs-local cluster
# Copyright 2026 University of Sheffield

defmodule FPlusACSLocalTest do
  # Run as for test/fplus/credentials_acs_local_test.exs (see the README).

  use ExUnit.Case, async: false

  alias FPlus.Service

  @moduletag :acs_local
  @moduletag :capture_log

  defp wait_until(fun, tries \\ 300) do
    cond do
      fun.() -> :ok
      tries == 0 -> flunk("timed out waiting")
      true -> Process.sleep(100) && wait_until(fun, tries - 1)
    end
  end

  test "starts from the environment, and finds the broker through the Directory" do
    keytab = System.get_env("ACS_LOCAL_KEYTAB") || flunk("set ACS_LOCAL_KEYTAB; see the README")

    # What an ACS pod's environment gives it, less KRB5_CONFIG: the KDC
    # comes from :kdc here, as kerlberos reads a realm's config once per VM.
    env = %{"DIRECTORY_URL" => "http://directory.acs.localhost/", "CLIENT_KEYTAB" => keytab}
    name = :"fplus_#{System.unique_integer([:positive])}"
    start_supervised!({FPlus, [name: name, kdc: [{"127.0.0.1", 88}]] ++ FPlus.opts_from_env(env)})

    mqtt = FPlus.mqtt(name)
    :ok = FPlus.MQTT.subscribe(mqtt, "spBv1.0/#")
    wait_until(fn -> FPlus.MQTT.status(mqtt).connected end)

    # The principal came from the keytab, and the broker from the Directory.
    assert %{principal: "sv1warehouse@ACS.LOCALHOST"} =
             FPlus.Credentials.status(FPlus.credentials(name))

    assert %{broker: "mqtt.acs.localhost:1883"} = FPlus.MQTT.status(mqtt)

    assert_receive {:fplus_mqtt, topic, payload, _properties}, 15_000
    assert {:ok, %SparkplugB.Topic{}} = SparkplugB.Topic.parse(topic)
    assert {:ok, %SparkplugB.Payload{}} = SparkplugB.decode(payload, timestamp_unit: :auto)

    assert FPlus.Directory.get_service_url(FPlus.http(name), Service.command_escalation()) ==
             {:ok, "http://cmdesc.acs.localhost/"}
  end
end
