# ACS Service Client
# Tests for the MQTT connection that need no broker
# Copyright 2026 University of Sheffield

defmodule FPlus.MQTTTest do
  use ExUnit.Case, async: true

  alias FPlus.Credentials
  alias FPlus.MQTT

  # No login happens, so no connection is ever attempted.
  @moduletag :capture_log

  setup do
    n = System.unique_integer([:positive])
    credentials = :"credentials_#{n}"
    name = :"mqtt_#{n}"

    start_supervised!(
      {Credentials,
       name: credentials,
       principal: "sv1test@TEST-#{n}.INVALID",
       password: "not-a-real-password",
       kdc: [{"127.0.0.1", 9}]}
    )

    start_supervised!(
      {MQTT, name: name, credentials: credentials, url: "mqtt://broker.test.invalid:1883"}
    )

    %{name: name, connection: Module.concat(name, "Connection")}
  end

  # What emqtt sends its owner for an incoming message.
  defp incoming(connection, topic, payload) do
    send(connection, {:publish, %{topic: topic, payload: payload, properties: %{}}})
  end

  test "starts disconnected, without waiting", %{name: name} do
    assert %{connected: false, connected_at: nil, subscriptions: []} = MQTT.status(name)
  end

  test "publishing while disconnected is an error", %{name: name} do
    assert MQTT.publish(name, "test/topic", "payload") == {:error, :not_connected}
  end

  test "a subscription made while disconnected is kept for the connect", %{name: name} do
    {time, result} = :timer.tc(fn -> MQTT.subscribe(name, "spBv1.0/#") end)

    assert result == :ok
    assert time < 500_000
    assert %{subscriptions: ["spBv1.0/#"]} = MQTT.status(name)
  end

  test "an invalid filter is an argument error", %{name: name} do
    assert_raise ArgumentError, fn -> MQTT.subscribe(name, "spBv1.0/#/DDATA") end
  end

  test "a broker URL that isn't mqtt:// stops the connection" do
    Process.flag(:trap_exit, true)

    assert {:error, _reason} =
             MQTT.start_link(name: :bad_url, credentials: :none, url: "http://broker:1883")
  end

  describe "delivery" do
    test "goes to each subscriber of a matching filter", %{name: name, connection: connection} do
      :ok = MQTT.subscribe(name, "spBv1.0/+/DDATA/#")
      incoming(connection, "spBv1.0/Site_1/DDATA/Edge_1/Pump_3", "payload")

      assert_receive {:fplus_mqtt, "spBv1.0/Site_1/DDATA/Edge_1/Pump_3", "payload", %{}}
    end

    test "skips subscribers whose filters don't match", %{name: name, connection: connection} do
      :ok = MQTT.subscribe(name, "spBv1.0/+/NDATA/+")
      incoming(connection, "spBv1.0/Site_1/DDATA/Edge_1/Pump_3", "payload")

      refute_receive {:fplus_mqtt, _topic, _payload, _properties}, 100
    end

    test "happens once for overlapping filters", %{name: name, connection: connection} do
      :ok = MQTT.subscribe(name, "spBv1.0/#")
      :ok = MQTT.subscribe(name, "spBv1.0/+/DDATA/#")
      incoming(connection, "spBv1.0/Site_1/DDATA/Edge_1/Pump_3", "payload")

      assert_receive {:fplus_mqtt, _topic, "payload", _properties}
      refute_receive {:fplus_mqtt, _topic, _payload, _properties}, 100
    end

    test "stops when the subscriber exits", %{name: name, connection: connection} do
      test = self()

      subscriber =
        spawn(fn ->
          :ok = MQTT.subscribe(name, "spBv1.0/#")
          send(test, :subscribed)

          receive do
            message -> send(test, {:subscriber_got, message})
          end
        end)

      assert_receive :subscribed
      ref = Process.monitor(subscriber)
      Process.exit(subscriber, :kill)
      assert_receive {:DOWN, ^ref, :process, ^subscriber, :killed}

      # The registry drops the entry when the subscriber exits.
      wait_until(fn -> Registry.lookup(Module.concat(name, "Registry"), "spBv1.0/#") == [] end)
      incoming(connection, "spBv1.0/Site_1/DDATA/Edge_1/Pump_3", "payload")

      refute_receive {:subscriber_got, _message}, 100
    end
  end

  defp wait_until(fun, tries \\ 50) do
    cond do
      fun.() -> :ok
      tries == 0 -> flunk("timed out waiting")
      true -> Process.sleep(10) && wait_until(fun, tries - 1)
    end
  end
end
