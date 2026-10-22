# ACS Ingest
# Tests for configuration from the environment
# Copyright 2026 University of Sheffield

defmodule Ingest.ConfigTest do
  use ExUnit.Case, async: true

  alias Ingest.Config

  @env %{
    "DIRECTORY_URL" => "http://directory.example",
    "SPARKPLUG_HISTORIAN" => "true",
    "SPARKPLUG_HISTORIAN_KEYTAB" => "/keytabs/sparkplug-historian",
    "INFLUX_URL" => "http://influxdb.example",
    "INFLUX_ORG" => "default",
    "INFLUX_TOKEN" => "secret-token"
  }

  defp error(env), do: elem(Config.from_env(env), 1)

  defp historian(env) do
    {:ok, %Config{parts: [part]}} = Config.from_env(env)
    part
  end

  test "reads the environment, with defaults" do
    assert {:ok, config} = Config.from_env(@env)

    assert config.influx_url == "http://influxdb.example"
    assert config.influx_org == "default"
    assert config.influx_token == "secret-token"
    assert config.log_level == :info

    assert [
             %Config.Part{
               name: :sparkplug_historian,
               fplus: [
                 directory_url: "http://directory.example",
                 keytab: "/keytabs/sparkplug-historian"
               ],
               stall_timeout: 600_000,
               connect_timeout: 300_000,
               writer: %{
                 bucket: "default",
                 batch_size: 5000,
                 flush_interval: 1000,
                 buffer_limit: 100_000
               }
             }
           ] = config.parts
  end

  test "reads the values the Helm chart sets" do
    env =
      Map.merge(@env, %{
        "SPARKPLUG_HISTORIAN_BUCKET" => "default-elixir",
        "SPARKPLUG_HISTORIAN_BATCH_SIZE" => "200",
        "SPARKPLUG_HISTORIAN_FLUSH_INTERVAL" => "10000",
        "SPARKPLUG_HISTORIAN_BUFFER_LIMIT" => "20000",
        "SPARKPLUG_HISTORIAN_STALL_TIMEOUT" => "60",
        "SPARKPLUG_HISTORIAN_CONNECT_TIMEOUT" => " 30 ",
        "LOG_LEVEL" => "warn"
      })

    assert {:ok, %Config{log_level: :warning, parts: [part]}} = Config.from_env(env)

    assert part.writer == %{
             bucket: "default-elixir",
             batch_size: 200,
             flush_interval: 10_000,
             buffer_limit: 20_000
           }

    assert {part.stall_timeout, part.connect_timeout} == {60_000, 30_000}
  end

  test "treats empty variables as unset" do
    part =
      historian(
        Map.merge(@env, %{
          "SPARKPLUG_HISTORIAN_BUCKET" => "",
          "SPARKPLUG_HISTORIAN_BATCH_SIZE" => ""
        })
      )

    assert {part.writer.bucket, part.writer.batch_size} == {"default", 5000}
    assert error(Map.put(@env, "INFLUX_TOKEN", "")) == "INFLUX_TOKEN isn't set"
  end

  test "needs the Factory+ variables, and a keytab for each part" do
    assert error(Map.delete(@env, "DIRECTORY_URL")) == "DIRECTORY_URL isn't set"

    assert error(Map.delete(@env, "SPARKPLUG_HISTORIAN_KEYTAB")) ==
             "SPARKPLUG_HISTORIAN_KEYTAB isn't set"
  end

  test "needs a part to be on" do
    for env <- [
          Map.delete(@env, "SPARKPLUG_HISTORIAN"),
          Map.put(@env, "SPARKPLUG_HISTORIAN", "false")
        ] do
      assert error(env) == "no parts are on: set SPARKPLUG_HISTORIAN or UNS_INGESTER to true"
    end

    assert error(Map.put(@env, "SPARKPLUG_HISTORIAN", "yes")) ==
             ~s(SPARKPLUG_HISTORIAN must be true or false, got "yes")
  end

  test "a part that is off needs none of its variables" do
    env =
      Map.merge(@env, %{"SPARKPLUG_HISTORIAN" => "false", "SPARKPLUG_HISTORIAN_BATCH_SIZE" => "x"})

    assert error(Map.delete(env, "SPARKPLUG_HISTORIAN_KEYTAB")) =~ "no parts are on"
  end

  test "the UNS ingester has its own keytab and checks, and no writer" do
    env =
      Map.merge(@env, %{
        "UNS_INGESTER" => "true",
        "UNS_INGESTER_KEYTAB" => "/keytabs/uns-ingester",
        "UNS_INGESTER_STALL_TIMEOUT" => "120"
      })

    assert {:ok, %Config{parts: [%{name: :sparkplug_historian}, part]}} = Config.from_env(env)

    assert part == %Config.Part{
             name: :uns_ingester,
             fplus: [directory_url: "http://directory.example", keytab: "/keytabs/uns-ingester"],
             stall_timeout: 120_000,
             connect_timeout: 300_000,
             writer: nil
           }

    assert error(Map.delete(env, "UNS_INGESTER_KEYTAB")) == "UNS_INGESTER_KEYTAB isn't set"
  end

  test "doesn't need InfluxDB when no historian is on" do
    env = %{
      "DIRECTORY_URL" => "http://directory.example",
      "UNS_INGESTER" => "true",
      "UNS_INGESTER_KEYTAB" => "/keytabs/uns-ingester"
    }

    assert {:ok, %Config{parts: [%{name: :uns_ingester}], influx_url: nil}} =
             Config.from_env(env)
  end

  test "needs InfluxDB when a historian is on" do
    for variable <- ["INFLUX_URL", "INFLUX_ORG", "INFLUX_TOKEN"] do
      assert error(Map.delete(@env, variable)) == "#{variable} isn't set"
    end

    for url <- ["influxdb.example", "ftp://influxdb.example", "http://"] do
      assert error(Map.put(@env, "INFLUX_URL", url)) ==
               "INFLUX_URL must be an http or https URL, got #{inspect(url)}"
    end
  end

  test "rejects numbers that aren't whole and positive" do
    for value <- ["ten", "1.5", "-1", "10ms"] do
      assert error(Map.put(@env, "SPARKPLUG_HISTORIAN_BATCH_SIZE", value)) ==
               "SPARKPLUG_HISTORIAN_BATCH_SIZE must be a whole number, got #{inspect(value)}"
    end

    assert error(Map.put(@env, "SPARKPLUG_HISTORIAN_FLUSH_INTERVAL", "0")) ==
             "SPARKPLUG_HISTORIAN_FLUSH_INTERVAL must be above 0"
  end

  test "needs room in the buffer for a batch" do
    env =
      Map.merge(@env, %{
        "SPARKPLUG_HISTORIAN_BATCH_SIZE" => "500",
        "SPARKPLUG_HISTORIAN_BUFFER_LIMIT" => "499"
      })

    assert error(env) ==
             "SPARKPLUG_HISTORIAN_BUFFER_LIMIT must be at least SPARKPLUG_HISTORIAN_BATCH_SIZE, " <>
               "500, got 499"
  end

  test "turns a health check off with 0" do
    env =
      Map.merge(@env, %{
        "SPARKPLUG_HISTORIAN_STALL_TIMEOUT" => "0",
        "SPARKPLUG_HISTORIAN_CONNECT_TIMEOUT" => "0"
      })

    assert %Config.Part{stall_timeout: nil, connect_timeout: nil} = historian(env)

    assert error(Map.put(@env, "SPARKPLUG_HISTORIAN_STALL_TIMEOUT", "5m")) ==
             ~s(SPARKPLUG_HISTORIAN_STALL_TIMEOUT must be a whole number, got "5m")
  end

  test "maps the pino log levels onto Logger's" do
    levels = %{
      "fatal" => :critical,
      "error" => :error,
      "warn" => :warning,
      "info" => :info,
      "debug" => :debug,
      "trace" => :debug,
      "silent" => :none
    }

    for {name, level} <- levels do
      assert {:ok, %Config{log_level: ^level}} = Config.from_env(Map.put(@env, "LOG_LEVEL", name))
    end

    assert error(Map.put(@env, "LOG_LEVEL", "warning")) ==
             ~s(LOG_LEVEL must be one of debug, error, fatal, info, silent, trace, warn, got "warning")
  end

  test "leaves the InfluxDB token out of inspect" do
    {:ok, config} = Config.from_env(@env)

    refute inspect(config) =~ "secret-token"
  end
end
