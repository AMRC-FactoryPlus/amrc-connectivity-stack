# ACS Service Client
# Tests for Kerberos credentials against the acs-local cluster
# Copyright 2026 University of Sheffield

defmodule FPlus.CredentialsACSLocalTest do
  # Run with the acs-local cluster up (see the README):
  #
  #   ACS_LOCAL_PASSWORD="$(acs-local password)" \
  #   ACS_LOCAL_KEYTAB=<path to the sv1warehouse keytab> \
  #   mix test --include acs_local

  use ExUnit.Case, async: false

  alias FPlus.Credentials

  @moduletag :acs_local
  @moduletag :capture_log

  @realm "ACS.LOCALHOST"
  @kdc [{"127.0.0.1", 88}]
  @broker [host: ~c"127.0.0.1", port: 1883]
  @mqtt_host "mqtt.acs.localhost"

  defp env!(name), do: System.get_env(name) || flunk("set #{name}; see the README")

  defp start_logged_in(opts) do
    {:ok, pid} = start_supervised({Credentials, [kdc: @kdc] ++ opts}, id: make_ref())
    wait_until(fn -> Credentials.status(pid).logged_in end)
    pid
  end

  # Up to 30 seconds: the first login after the cluster starts can be slow.
  defp wait_until(fun, tries \\ 300) do
    cond do
      fun.() -> :ok
      tries == 0 -> flunk("timed out waiting")
      true -> Process.sleep(100) && wait_until(fun, tries - 1)
    end
  end

  # Connect to the broker with a token. Returns the broker's reply token,
  # or the error if it refuses.
  defp mqtt_connect(token) do
    Process.flag(:trap_exit, true)

    {:ok, pid} =
      :emqtt.start_link(
        @broker ++
          [
            proto_ver: :v5,
            clientid: "fplus-test-#{System.unique_integer([:positive])}",
            properties: %{"Authentication-Method": "GSSAPI", "Authentication-Data": token}
          ]
      )

    case :emqtt.connect(pid) do
      {:ok, connack} ->
        :ok = :emqtt.disconnect(pid)
        {:ok, connack[:"Authentication-Data"]}

      {:error, reason} ->
        {:error, reason}
    end
  end

  test "logs in with a password, and the broker accepts the token" do
    pid = start_logged_in(principal: "admin@#{@realm}", password: env!("ACS_LOCAL_PASSWORD"))

    assert %{logged_in: true, expires: %DateTime{}} = Credentials.status(pid)
    assert {:ok, token, context} = Credentials.initiate(pid, "mqtt", @mqtt_host)
    assert {:ok, reply} = mqtt_connect(token)
    assert Credentials.verify(context, reply) == :ok
  end

  test "logs in from a keytab, and the broker accepts the token" do
    pid = start_logged_in(principal: "sv1warehouse@#{@realm}", keytab: env!("ACS_LOCAL_KEYTAB"))

    assert {:ok, token, context} = Credentials.initiate(pid, "mqtt", @mqtt_host)
    assert {:ok, reply} = mqtt_connect(token)
    assert Credentials.verify(context, reply) == :ok
  end

  test "the broker refuses a token used twice, so each connection needs its own" do
    pid = start_logged_in(principal: "admin@#{@realm}", password: env!("ACS_LOCAL_PASSWORD"))
    {:ok, token, _context} = Credentials.initiate(pid, "mqtt", @mqtt_host)

    assert {:ok, _reply} = mqtt_connect(token)
    assert {:error, _replay} = mqtt_connect(token)
  end

  test "a reply meant for another token fails verification" do
    pid = start_logged_in(principal: "admin@#{@realm}", password: env!("ACS_LOCAL_PASSWORD"))
    {:ok, token, _context} = Credentials.initiate(pid, "mqtt", @mqtt_host)
    {:ok, _other_token, other_context} = Credentials.initiate(pid, "mqtt", @mqtt_host)
    {:ok, reply} = mqtt_connect(token)

    assert {:error, {:gss, _reason}} = Credentials.verify(other_context, reply)
  end

  test "concurrent requests share one service ticket" do
    pid = start_logged_in(principal: "admin@#{@realm}", password: env!("ACS_LOCAL_PASSWORD"))

    results =
      1..20
      |> Task.async_stream(fn _n -> Credentials.initiate(pid, "mqtt", @mqtt_host) end)
      |> Enum.map(fn {:ok, result} -> result end)

    assert Enum.all?(results, &match?({:ok, _token, _context}, &1))
    assert %{tickets: tickets, pending: pending} = :sys.get_state(pid)
    assert map_size(tickets) == 1
    assert pending == %{}
  end

  test "a wrong password never logs in" do
    {:ok, pid} =
      start_supervised(
        {Credentials, kdc: @kdc, principal: "admin@#{@realm}", password: "not-the-password"}
      )

    Process.sleep(1500)
    assert %{logged_in: false} = Credentials.status(pid)
    assert Credentials.initiate(pid, "mqtt", @mqtt_host) == {:error, :unavailable}
  end
end
