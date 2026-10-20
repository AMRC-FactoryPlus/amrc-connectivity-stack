# ACS Service Client
# Tests for HTTP requests against the acs-local cluster
# Copyright 2026 University of Sheffield

defmodule FPlus.HTTPACSLocalTest do
  # Run as for credentials_acs_local_test.exs (see the README). The
  # rebirth tests ask the cluster's edge agent to resend its births.

  use ExUnit.Case, async: false

  alias FPlus.CmdEsc
  alias FPlus.Credentials
  alias FPlus.Directory
  alias FPlus.HTTP
  alias FPlus.MQTT
  alias FPlus.Service

  @moduletag :acs_local
  @moduletag :capture_log

  @kdc [{"127.0.0.1", 88}]
  @directory_url "http://directory.acs.localhost/"
  @group "LOCAL-Central"
  @node "Test_Node"

  defp env!(name), do: System.get_env(name) || flunk("set #{name}; see the README")

  # Log in as sv1warehouse, as the historian does.
  setup do
    n = System.unique_integer([:positive])
    credentials = :"credentials_#{n}"
    http = :"http_#{n}"

    start_supervised!(
      {Credentials,
       name: credentials,
       principal: "sv1warehouse@ACS.LOCALHOST",
       keytab: env!("ACS_LOCAL_KEYTAB"),
       kdc: @kdc}
    )

    start_supervised!({HTTP, name: http, credentials: credentials, directory_url: @directory_url})
    wait_until(fn -> Credentials.status(credentials).logged_in end)

    %{http: http, credentials: credentials, n: n}
  end

  defp wait_until(fun, tries \\ 300) do
    cond do
      fun.() -> :ok
      tries == 0 -> flunk("timed out waiting")
      true -> Process.sleep(100) && wait_until(fun, tries - 1)
    end
  end

  defp tokens(http), do: :sys.get_state(Module.concat(http, "Tokens")).tokens

  describe "the Directory" do
    test "gives service URLs", %{http: http} do
      assert Directory.get_service_url(http, Service.command_escalation()) ==
               {:ok, "http://cmdesc.acs.localhost/"}

      assert {:ok, %{"url" => "http://" <> _}} =
               Directory.get_service_info(http, Service.configdb())
    end

    test "says when a service isn't registered", %{http: http} do
      assert Directory.get_service_info(http, "00000000-0000-0000-0000-00000000dead") ==
               {:error, :not_found}
    end
  end

  describe "tokens" do
    test "are reused", %{http: http} do
      {:ok, _info} = Directory.get_service_info(http, Service.configdb())
      first = tokens(http)
      {:ok, _info} = Directory.get_service_info(http, Service.mqtt())

      assert map_size(first) == 1
      assert tokens(http) == first
    end

    test "are fetched again when a service refuses one", %{http: http} do
      {:ok, _info} = Directory.get_service_info(http, Service.configdb())
      bogus = "not-a-real-token"

      :sys.replace_state(Module.concat(http, "Tokens"), fn state ->
        put_in(state.tokens[@directory_url], {bogus, nil})
      end)

      assert {:ok, _info} = Directory.get_service_info(http, Service.configdb())
      assert {token, _expires} = tokens(http)[@directory_url]
      assert token != bogus
    end
  end

  describe "Command Escalation" do
    setup %{credentials: credentials, n: n} do
      mqtt = :"mqtt_#{n}"

      start_supervised!(
        {MQTT, name: mqtt, credentials: credentials, url: "mqtt://mqtt.acs.localhost:1883"}
      )

      wait_until(fn -> MQTT.status(mqtt).connected end)
      %{mqtt: mqtt}
    end

    test "rebirths a node", %{http: http, mqtt: mqtt} do
      topic = "spBv1.0/#{@group}/NBIRTH/#{@node}"
      :ok = MQTT.subscribe(mqtt, topic)

      assert CmdEsc.rebirth(http, %{group: @group, node: @node}) == :ok
      assert_receive {:fplus_mqtt, ^topic, payload, _properties}, 15_000
      assert {:ok, %SparkplugB.Payload{metrics: [_ | _]}} = SparkplugB.decode(payload)
    end

    test "rebirths a device whose name has a space", %{http: http, mqtt: mqtt} do
      topic = "spBv1.0/#{@group}/DBIRTH/#{@node}/Test Device"
      :ok = MQTT.subscribe(mqtt, topic)

      assert CmdEsc.rebirth(http, %{group: @group, node: @node, device: "Test Device"}) == :ok
      assert_receive {:fplus_mqtt, ^topic, _payload, _properties}, 15_000
    end
  end
end
