# ACS Ingest
# Configuration from the environment
# Copyright 2026 University of Sheffield

defmodule Ingest.Config do
  @moduledoc """
  The service's configuration, read from the environment when it starts.

  The variables are the ones the JS historian and ACS's Helm chart use.
  A variable set to the empty string counts as unset.

  ## Factory+

  Read by `FPlus.opts_from_env/1`: `DIRECTORY_URL` and `CLIENT_KEYTAB`
  (required), and `MQTT_URL`, `CONFIGDB_URL` and `AUTHN_URL`. The KDC
  comes from `KRB5_CONFIG`.

  ## Parts

  Each part is off unless its variable is `true`, and at least one must
  be on:

    * `SPARKPLUG_HISTORIAN` - write Sparkplug device data to InfluxDB

  ## InfluxDB

  Required when a historian is on:

    * `INFLUX_URL` - an `http` or `https` URL
    * `INFLUX_ORG`
    * `INFLUX_TOKEN`
    * `INFLUX_BUCKET` - default `default`

  ## Batching

    * `BATCH_SIZE` - flush after this many points; default 5000
    * `FLUSH_INTERVAL` - flush at least this often, in milliseconds;
      default 1000. The JS historian's chart value was 10000.

  ## Health

  In whole seconds, with 0 to turn the check off. The struct holds them
  in milliseconds, or `nil` when off.

    * `STALL_TIMEOUT` - default 600
    * `CONNECT_TIMEOUT` - default 300

  ## Logging

    * `LOG_LEVEL` - one of the pino level names the chart documents:
      `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`.
      Default `info`. It is mapped to a `Logger` level.
  """

  @derive {Inspect, except: [:influx_token]}
  @enforce_keys [
    :fplus,
    :sparkplug_historian,
    :batch_size,
    :flush_interval,
    :stall_timeout,
    :connect_timeout,
    :log_level
  ]
  defstruct @enforce_keys ++ [:influx_url, :influx_org, :influx_bucket, :influx_token]

  @type t :: %__MODULE__{
          fplus: keyword(),
          sparkplug_historian: boolean(),
          influx_url: String.t() | nil,
          influx_org: String.t() | nil,
          influx_bucket: String.t() | nil,
          influx_token: String.t() | nil,
          batch_size: pos_integer(),
          flush_interval: pos_integer(),
          stall_timeout: pos_integer() | nil,
          connect_timeout: pos_integer() | nil,
          log_level: Logger.level() | :none
        }

  @log_levels %{
    "fatal" => :critical,
    "error" => :error,
    "warn" => :warning,
    "info" => :info,
    "debug" => :debug,
    "trace" => :debug,
    "silent" => :none
  }

  @doc """
  Read the configuration from `env`, the environment by default.

  Returns `{:error, message}` naming the first variable that is missing
  or invalid.
  """
  @spec from_env(%{String.t() => String.t()}) :: {:ok, t()} | {:error, String.t()}
  def from_env(env \\ System.get_env()) do
    env = Map.reject(env, fn {_variable, value} -> value == "" end)

    with {:ok, fplus} <- fplus(env),
         {:ok, historian} <- flag(env, "SPARKPLUG_HISTORIAN"),
         :ok <- some_part([historian]),
         {:ok, influx} <- influx(env, historian),
         {:ok, batch_size} <- positive(env, "BATCH_SIZE", 5000),
         {:ok, flush_interval} <- positive(env, "FLUSH_INTERVAL", 1000),
         {:ok, stall_timeout} <- timeout(env, "STALL_TIMEOUT", 600),
         {:ok, connect_timeout} <- timeout(env, "CONNECT_TIMEOUT", 300),
         {:ok, log_level} <- log_level(env) do
      {:ok,
       struct!(
         __MODULE__,
         [
           fplus: fplus,
           sparkplug_historian: historian,
           batch_size: batch_size,
           flush_interval: flush_interval,
           stall_timeout: stall_timeout,
           connect_timeout: connect_timeout,
           log_level: log_level
         ] ++ influx
       )}
    end
  end

  defp fplus(env) do
    {:ok, FPlus.opts_from_env(env)}
  rescue
    error in ArgumentError -> {:error, Exception.message(error)}
  end

  defp flag(env, variable) do
    case env[variable] do
      nil -> {:ok, false}
      "true" -> {:ok, true}
      "false" -> {:ok, false}
      other -> {:error, "#{variable} must be true or false, got #{inspect(other)}"}
    end
  end

  defp some_part(parts) do
    if Enum.any?(parts),
      do: :ok,
      else: {:error, "no parts are on: set SPARKPLUG_HISTORIAN to true"}
  end

  defp influx(_env, false), do: {:ok, []}

  defp influx(env, true) do
    with {:ok, url} <- required(env, "INFLUX_URL"),
         :ok <- http_url("INFLUX_URL", url),
         {:ok, org} <- required(env, "INFLUX_ORG"),
         {:ok, token} <- required(env, "INFLUX_TOKEN") do
      {:ok,
       [
         influx_url: url,
         influx_org: org,
         influx_bucket: Map.get(env, "INFLUX_BUCKET", "default"),
         influx_token: token
       ]}
    end
  end

  defp required(env, variable) do
    case env[variable] do
      nil -> {:error, "#{variable} isn't set"}
      value -> {:ok, value}
    end
  end

  defp http_url(variable, url) do
    case URI.new(url) do
      {:ok, %URI{scheme: scheme, host: host}}
      when scheme in ["http", "https"] and host not in [nil, ""] ->
        :ok

      _invalid ->
        {:error, "#{variable} must be an http or https URL, got #{inspect(url)}"}
    end
  end

  defp positive(env, variable, default) do
    case whole_number(env, variable, default) do
      {:ok, n} when n > 0 -> {:ok, n}
      {:ok, _zero} -> {:error, "#{variable} must be above 0"}
      error -> error
    end
  end

  defp timeout(env, variable, default) do
    case whole_number(env, variable, default) do
      {:ok, 0} -> {:ok, nil}
      {:ok, seconds} -> {:ok, seconds * 1000}
      error -> error
    end
  end

  defp whole_number(env, variable, default) do
    with value when is_binary(value) <- env[variable],
         {n, ""} when n >= 0 <- Integer.parse(String.trim(value)) do
      {:ok, n}
    else
      nil -> {:ok, default}
      _invalid -> {:error, "#{variable} must be a whole number, got #{inspect(env[variable])}"}
    end
  end

  defp log_level(env) do
    value = Map.get(env, "LOG_LEVEL", "info")

    case Map.fetch(@log_levels, value) do
      {:ok, level} ->
        {:ok, level}

      :error ->
        names = @log_levels |> Map.keys() |> Enum.sort() |> Enum.join(", ")
        {:error, "LOG_LEVEL must be one of #{names}, got #{inspect(value)}"}
    end
  end
end
