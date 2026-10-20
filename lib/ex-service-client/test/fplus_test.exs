# ACS Service Client
# Tests for the client's supervisor and options, and the dependencies
# Copyright 2026 University of Sheffield

defmodule FPlusTest do
  use ExUnit.Case, async: true

  alias FPlus.Service
  alias FPlus.Test.Keytab

  describe "opts_from_env/1" do
    test "reads the variables the JS client and Helm chart use" do
      env = %{
        "DIRECTORY_URL" => "http://directory.test.invalid/",
        "CLIENT_KEYTAB" => "/keytabs/client",
        "MQTT_URL" => "mqtt://mqtt.test.invalid",
        "CONFIGDB_URL" => "http://configdb.test.invalid/",
        "AUTHN_URL" => ""
      }

      assert FPlus.opts_from_env(env) == [
               directory_url: "http://directory.test.invalid/",
               keytab: "/keytabs/client",
               mqtt_url: "mqtt://mqtt.test.invalid",
               service_urls: %{Service.configdb() => "http://configdb.test.invalid/"}
             ]
    end

    test "needs DIRECTORY_URL and CLIENT_KEYTAB" do
      assert_raise ArgumentError, ~r/DIRECTORY_URL/, fn ->
        FPlus.opts_from_env(%{"CLIENT_KEYTAB" => "/keytabs/client"})
      end

      assert_raise ArgumentError, ~r/CLIENT_KEYTAB/, fn ->
        FPlus.opts_from_env(%{"DIRECTORY_URL" => "http://d/", "CLIENT_KEYTAB" => ""})
      end
    end
  end

  describe "the client" do
    @describetag :tmp_dir
    # No login happens, so nothing connects.
    @describetag :capture_log

    setup %{tmp_dir: dir} do
      n = System.unique_integer([:positive])

      keytab =
        Keytab.write!(Path.join(dir, "client.keytab"), [
          %{
            principal: "sv1test",
            realm: "TEST-#{n}.INVALID",
            etype: :aes256_hmac_sha1,
            key: "not-a-key-0123456789abcdef012345"
          }
        ])

      opts = [
        name: :"fplus_#{n}",
        directory_url: "http://directory.test.invalid/",
        keytab: keytab,
        kdc: [{"127.0.0.1", 9}]
      ]

      %{opts: opts, name: opts[:name]}
    end

    test "starts credentials, HTTP and MQTT", %{opts: opts, name: name} do
      start_supervised!({FPlus, opts})

      assert %{principal: "sv1test@" <> _realm} =
               FPlus.Credentials.status(FPlus.credentials(name))

      assert {:ok, "http://directory.test.invalid/"} =
               FPlus.HTTP.service_url(FPlus.http(name), Service.directory())

      # The broker will be found in the Directory, once logged in.
      assert %{connected: false, broker: nil} = FPlus.MQTT.status(FPlus.mqtt(name))
    end

    test "can leave MQTT out", %{opts: opts, name: name} do
      start_supervised!({FPlus, [mqtt: false] ++ opts})

      assert Process.whereis(FPlus.http(name))
      refute Process.whereis(FPlus.mqtt(name))
    end

    test "restarts the credentials process without touching MQTT", %{opts: opts, name: name} do
      start_supervised!({FPlus, opts})
      credentials = Process.whereis(FPlus.credentials(name))
      connection = Process.whereis(Module.concat(FPlus.mqtt(name), "Connection"))

      ref = Process.monitor(credentials)
      Process.exit(credentials, :kill)
      assert_receive {:DOWN, ^ref, :process, ^credentials, :killed}

      wait_until(fn -> Process.whereis(FPlus.credentials(name)) not in [nil, credentials] end)
      assert Process.whereis(Module.concat(FPlus.mqtt(name), "Connection")) == connection
    end
  end

  defp wait_until(fun, tries \\ 50) do
    cond do
      fun.() -> :ok
      tries == 0 -> flunk("timed out waiting")
      true -> Process.sleep(10) && wait_until(fun, tries - 1)
    end
  end

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
