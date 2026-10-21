# ACS Ingest
# Tests for configuration from the environment
# Copyright 2026 University of Sheffield

defmodule Ingest.ConfigTest do
  use ExUnit.Case, async: true

  alias Ingest.Config

  @env %{
    "DIRECTORY_URL" => "http://directory.example",
    "CLIENT_KEYTAB" => "/keytabs/client",
    "SPARKPLUG_HISTORIAN" => "true",
    "INFLUX_URL" => "http://influxdb.example",
    "INFLUX_ORG" => "default",
    "INFLUX_TOKEN" => "secret-token"
  }

  defp error(env), do: elem(Config.from_env(env), 1)

  test "reads the environment, with defaults" do
    assert {:ok, config} = Config.from_env(@env)

    assert config.fplus == [directory_url: "http://directory.example", keytab: "/keytabs/client"]
    assert config.sparkplug_historian
    assert config.influx_url == "http://influxdb.example"
    assert config.influx_org == "default"
    assert config.influx_bucket == "default"
    assert config.influx_token == "secret-token"
    assert config.batch_size == 5000
    assert config.flush_interval == 1000
    assert config.stall_timeout == 600_000
    assert config.connect_timeout == 300_000
    assert config.log_level == :info
  end

  test "reads the values the Helm chart sets" do
    env =
      Map.merge(@env, %{
        "INFLUX_BUCKET" => "default-elixir",
        "BATCH_SIZE" => "200",
        "FLUSH_INTERVAL" => "10000",
        "STALL_TIMEOUT" => "60",
        "CONNECT_TIMEOUT" => " 30 ",
        "LOG_LEVEL" => "warn"
      })

    assert {:ok, config} = Config.from_env(env)
    assert config.influx_bucket == "default-elixir"
    assert config.batch_size == 200
    assert config.flush_interval == 10_000
    assert config.stall_timeout == 60_000
    assert config.connect_timeout == 30_000
    assert config.log_level == :warning
  end

  test "treats empty variables as unset" do
    assert {:ok, config} =
             Config.from_env(Map.merge(@env, %{"INFLUX_BUCKET" => "", "BATCH_SIZE" => ""}))

    assert config.influx_bucket == "default"
    assert config.batch_size == 5000

    assert error(Map.put(@env, "INFLUX_TOKEN", "")) == "INFLUX_TOKEN isn't set"
  end

  test "needs the Factory+ variables" do
    assert error(Map.delete(@env, "DIRECTORY_URL")) == "DIRECTORY_URL isn't set"
    assert error(Map.delete(@env, "CLIENT_KEYTAB")) == "CLIENT_KEYTAB isn't set"
  end

  test "needs a part to be on" do
    for env <- [
          Map.delete(@env, "SPARKPLUG_HISTORIAN"),
          Map.put(@env, "SPARKPLUG_HISTORIAN", "false")
        ] do
      assert error(env) == "no parts are on: set SPARKPLUG_HISTORIAN to true"
    end

    assert error(Map.put(@env, "SPARKPLUG_HISTORIAN", "yes")) ==
             ~s(SPARKPLUG_HISTORIAN must be true or false, got "yes")
  end

  test "needs InfluxDB when the historian is on" do
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
      assert error(Map.put(@env, "BATCH_SIZE", value)) ==
               "BATCH_SIZE must be a whole number, got #{inspect(value)}"
    end

    assert error(Map.put(@env, "FLUSH_INTERVAL", "0")) == "FLUSH_INTERVAL must be above 0"
  end

  test "turns a health check off with 0" do
    env = Map.merge(@env, %{"STALL_TIMEOUT" => "0", "CONNECT_TIMEOUT" => "0"})

    assert {:ok, %Config{stall_timeout: nil, connect_timeout: nil}} = Config.from_env(env)

    assert error(Map.put(@env, "STALL_TIMEOUT", "5m")) ==
             ~s(STALL_TIMEOUT must be a whole number, got "5m")
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
