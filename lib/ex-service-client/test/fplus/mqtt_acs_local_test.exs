# ACS Service Client
# Tests for the MQTT connection against the acs-local cluster
# Copyright 2026 University of Sheffield

defmodule FPlus.MQTTACSLocalTest do
  # Run as for credentials_acs_local_test.exs (see the README). These
  # need Sparkplug traffic on the cluster, which its edge agent sends.

  use ExUnit.Case, async: false

  alias FPlus.Credentials
  alias FPlus.MQTT

  @moduletag :acs_local
  @moduletag :capture_log

  @kdc [{"127.0.0.1", 88}]
  @url "mqtt://mqtt.acs.localhost:1883"

  defp env!(name), do: System.get_env(name) || flunk("set #{name}; see the README")

  defp start_mqtt(credential_opts) do
    n = System.unique_integer([:positive])
    credentials = :"credentials_#{n}"
    name = :"mqtt_#{n}"

    start_supervised!({Credentials, [name: credentials, kdc: @kdc] ++ credential_opts},
      id: credentials
    )

    start_supervised!({MQTT, name: name, credentials: credentials, url: @url}, id: name)
    name
  end

  defp wait_until(fun, tries \\ 300) do
    cond do
      fun.() -> :ok
      tries == 0 -> flunk("timed out waiting")
      true -> Process.sleep(100) && wait_until(fun, tries - 1)
    end
  end

  defp assert_sparkplug_message do
    assert_receive {:fplus_mqtt, topic, payload, _properties}, 15_000
    assert {:ok, %SparkplugB.Topic{}} = SparkplugB.Topic.parse(topic)
    assert {:ok, %SparkplugB.Payload{}} = SparkplugB.decode(payload, timestamp_unit: :auto)
  end

  defp flush_messages do
    receive do
      {:fplus_mqtt, _topic, _payload, _properties} -> flush_messages()
    after
      0 -> :ok
    end
  end

  test "connects with a password, and a subscription made first starts delivering" do
    name = start_mqtt(principal: "admin@ACS.LOCALHOST", password: env!("ACS_LOCAL_PASSWORD"))

    # Subscribe before the connection is up.
    :ok = MQTT.subscribe(name, "spBv1.0/#")
    wait_until(fn -> MQTT.status(name).connected end)

    assert %{subscriptions: ["spBv1.0/#"], refused: %{}} = MQTT.status(name)
    assert_sparkplug_message()
  end

  test "connects from a keytab as sv1warehouse" do
    name = start_mqtt(principal: "sv1warehouse@ACS.LOCALHOST", keytab: env!("ACS_LOCAL_KEYTAB"))
    wait_until(fn -> MQTT.status(name).connected end)

    :ok = MQTT.subscribe(name, "spBv1.0/#")
    assert_sparkplug_message()
  end

  test "reconnects with a fresh token after the connection drops, keeping subscriptions" do
    name = start_mqtt(principal: "admin@ACS.LOCALHOST", password: env!("ACS_LOCAL_PASSWORD"))
    :ok = MQTT.subscribe(name, "spBv1.0/#")
    wait_until(fn -> MQTT.status(name).connected end)
    %{connected_at: first} = MQTT.status(name)

    # Kill the emqtt client under the connection.
    %{client: client} = :sys.get_state(Module.concat(name, "Connection"))
    Process.exit(client, :kill)

    wait_until(fn ->
      %{connected: connected, connected_at: at} = MQTT.status(name)
      connected and at != first
    end)

    flush_messages()
    assert_sparkplug_message()
  end
end
