# ACS Service Client
# Tests for HTTP requests that need no network
# Copyright 2026 University of Sheffield

defmodule FPlus.HTTPTest do
  use ExUnit.Case, async: true

  alias FPlus.Credentials
  alias FPlus.HTTP
  alias FPlus.Service
  alias FPlus.Test.Secrets

  # No login happens, so no request is ever made.
  @moduletag :capture_log

  @directory_url "http://directory.test.invalid/"
  @configdb_url "http://configdb.test.invalid/"

  setup do
    n = System.unique_integer([:positive])
    credentials = :"credentials_#{n}"
    name = :"http_#{n}"

    start_supervised!(
      {Credentials,
       name: credentials,
       principal: "sv1test@TEST-#{n}.INVALID",
       password: "not-a-real-password",
       kdc: [{"127.0.0.1", 9}]}
    )

    start_supervised!(
      {HTTP,
       name: name,
       credentials: credentials,
       directory_url: @directory_url,
       service_urls: %{Service.configdb() => @configdb_url}}
    )

    %{name: name}
  end

  test "the Directory's URL comes from the options", %{name: name} do
    assert HTTP.service_url(name, Service.directory()) == {:ok, @directory_url}
  end

  test "a preset service URL is used instead of the Directory", %{name: name} do
    assert HTTP.service_url(name, Service.configdb()) == {:ok, @configdb_url}
  end

  test "a request before logging in fails, without waiting", %{name: name} do
    {time, result} = :timer.tc(fn -> HTTP.request(name, Service.configdb(), :get, "v1/app") end)

    assert result == {:error, :unavailable}
    assert time < 500_000
  end

  test "a URL lookup before logging in fails, and isn't cached", %{name: name} do
    assert HTTP.service_url(name, Service.command_escalation()) == {:error, :unavailable}
    assert %{urls: urls, pending: pending} = :sys.get_state(Module.concat(name, "Tokens"))
    refute Map.has_key?(urls, Service.command_escalation())
    assert pending == %{}
  end

  test "a missing Directory URL stops the client" do
    Process.flag(:trap_exit, true)
    assert {:error, _reason} = HTTP.start_link(name: :no_directory, credentials: :none)
  end

  test "bearer tokens aren't in the status", %{name: name} do
    tokens = Module.concat(name, "Tokens")
    token = "not-a-real-bearer-token"

    :sys.replace_state(tokens, fn state ->
      put_in(state.tokens[@configdb_url], {token, nil})
    end)

    refute Secrets.contains?(:sys.get_status(tokens), token)
  end

  describe "responses" do
    defp response(headers, body),
      do: %Finch.Response{status: 200, headers: headers, body: body}

    test "JSON is decoded" do
      assert %{status: 200, body: %{"a" => 1}} =
               HTTP.decode(
                 response([{"Content-Type", "application/json; charset=utf-8"}], ~s({"a":1}))
               )

      assert %{body: %{"title" => "x"}} =
               HTTP.decode(
                 response([{"content-type", "application/problem+json"}], ~s({"title":"x"}))
               )
    end

    test "anything else is left as it is" do
      assert %{body: "hello"} = HTTP.decode(response([{"content-type", "text/plain"}], "hello"))
      assert %{body: ""} = HTTP.decode(response([{"content-type", "application/json"}], ""))

      assert %{body: "{not json"} =
               HTTP.decode(response([{"content-type", "application/json"}], "{not json"))
    end
  end

  test "a rebirth needs a group and a node", %{name: name} do
    assert_raise ArgumentError, fn -> FPlus.CmdEsc.rebirth(name, %{group: "", node: "Edge_1"}) end

    assert_raise ArgumentError, fn ->
      FPlus.CmdEsc.rebirth(name, %{group: "Site_1", node: nil})
    end
  end

  test "the service UUIDs match the JS client's" do
    js = File.read!(Path.expand("../../../js-service-client/lib/uuids.js", __DIR__))

    for {key, uuid} <- [
          {"Directory", Service.directory()},
          {"ConfigDB", Service.configdb()},
          {"Authentication", Service.authentication()},
          {"Command_Escalation", Service.command_escalation()},
          {"MQTT", Service.mqtt()}
        ] do
      assert js =~ ~s(#{key}: "#{uuid}"), "#{key} isn't #{uuid} in uuids.js"
    end
  end
end
