# ACS Ingest
# Configuration from the environment
# Copyright 2026 University of Sheffield

defmodule Ingest.Config do
  @moduledoc """
  The service's configuration, read from the environment when it starts.

  The service runs parts, each logged in to Factory+ as its own
  principal (see `Ingest`). Variables that every part shares have plain
  names; a part's own variables start with its name, such as
  `SPARKPLUG_HISTORIAN_KEYTAB`. A variable set to the empty string
  counts as unset.

  ## Parts

  Each part is off unless its variable is `true`, and at least one must
  be on:

    * `SPARKPLUG_HISTORIAN` - write Sparkplug device data to InfluxDB

  ## Factory+

  Shared, and read by `FPlus.opts_from_env/1`: `DIRECTORY_URL`
  (required), and `MQTT_URL`, `CONFIGDB_URL` and `AUTHN_URL`. The KDC
  comes from `KRB5_CONFIG`.

  For each part that is on:

    * `<PART>_KEYTAB` - required. The keytab of the part's principal.

  ## InfluxDB

  Shared, and required when a historian is on:

    * `INFLUX_URL` - an `http` or `https` URL
    * `INFLUX_ORG`
    * `INFLUX_TOKEN`

  For each historian that is on:

    * `<PART>_BUCKET` - default `default` for the Sparkplug historian
    * `<PART>_BATCH_SIZE` - flush after this many points; default 5000
    * `<PART>_FLUSH_INTERVAL` - flush at least this often, in
      milliseconds; default 1000. The JS historian's chart value was
      10000.
    * `<PART>_BUFFER_LIMIT` - the most points its writer holds while
      InfluxDB is slow or down; beyond it, the oldest are dropped.
      Default 100,000, and at least the batch size. The JS historian
      had no limit.

  ## Health

  For each part's `Ingest.StallMonitor`, in whole seconds, with 0 to
  turn the check off. The structs hold them in milliseconds, or `nil`
  when off.

    * `<PART>_STALL_TIMEOUT` - restart the part's Factory+ client after
      this long without a message, once one has arrived; default 600
    * `<PART>_CONNECT_TIMEOUT` - restart it after this long without an
      MQTT connection with its subscriptions granted; default 300

  ## Logging

    * `LOG_LEVEL` - shared. One of the pino level names the chart
      documents: `fatal`, `error`, `warn`, `info`, `debug`, `trace` or
      `silent`. Default `info`. It is mapped to a `Logger` level.
  """

  defmodule Part do
    @moduledoc """
    A part's configuration: its name, its `FPlus` options (with its own
    keytab), its stall monitor's timeouts, and for a historian, its
    writer's.
    """

    @enforce_keys [:name, :fplus, :stall_timeout, :connect_timeout, :writer]
    defstruct @enforce_keys

    @type writer :: %{
            bucket: String.t(),
            batch_size: pos_integer(),
            flush_interval: pos_integer(),
            buffer_limit: pos_integer()
          }

    @type t :: %__MODULE__{
            name: atom(),
            fplus: keyword(),
            stall_timeout: pos_integer() | nil,
            connect_timeout: pos_integer() | nil,
            writer: writer() | nil
          }
  end

  @derive {Inspect, except: [:influx_token]}
  @enforce_keys [:parts, :log_level]
  defstruct @enforce_keys ++ [:influx_url, :influx_org, :influx_token]

  @type t :: %__MODULE__{
          parts: [Part.t()],
          influx_url: String.t() | nil,
          influx_org: String.t() | nil,
          influx_token: String.t() | nil,
          log_level: Logger.level() | :none
        }

  # Each part: its variable, and for a historian, its default bucket.
  @parts [
    sparkplug_historian: %{variable: "SPARKPLUG_HISTORIAN", bucket: "default"}
  ]

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

    with {:ok, parts} <- parts(env),
         {:ok, influx} <- influx(env, Enum.any?(parts, & &1.writer)),
         {:ok, log_level} <- log_level(env) do
      {:ok, struct!(__MODULE__, [parts: parts, log_level: log_level] ++ influx)}
    end
  end

  defp parts(env) do
    results = for {name, part} <- @parts, do: part(env, name, part)

    case Enum.find(results, &match?({:error, _}, &1)) do
      {:error, _message} = error -> error
      nil -> some_part(for {:ok, part} <- results, do: part)
    end
  end

  defp some_part([]) do
    variables = Enum.map_join(@parts, " or ", fn {_name, part} -> part.variable end)
    {:error, "no parts are on: set #{variables} to true"}
  end

  defp some_part(parts), do: {:ok, parts}

  defp part(env, name, %{variable: variable} = part) do
    with {:ok, true} <- flag(env, variable),
         {:ok, keytab} <- required(env, variable <> "_KEYTAB"),
         {:ok, fplus} <- fplus(Map.put(env, "CLIENT_KEYTAB", keytab)),
         {:ok, stall_timeout} <- timeout(env, variable <> "_STALL_TIMEOUT", 600),
         {:ok, connect_timeout} <- timeout(env, variable <> "_CONNECT_TIMEOUT", 300),
         {:ok, writer} <- writer(env, variable, part) do
      {:ok,
       %Part{
         name: name,
         fplus: fplus,
         stall_timeout: stall_timeout,
         connect_timeout: connect_timeout,
         writer: writer
       }}
    else
      {:ok, false} -> :off
      error -> error
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

  defp writer(_env, _variable, %{bucket: nil}), do: {:ok, nil}

  defp writer(env, variable, %{bucket: bucket}) do
    with {:ok, batch_size} <- positive(env, variable <> "_BATCH_SIZE", 5000),
         {:ok, flush_interval} <- positive(env, variable <> "_FLUSH_INTERVAL", 1000),
         {:ok, buffer_limit} <- positive(env, variable <> "_BUFFER_LIMIT", 100_000),
         :ok <- at_least_batch(variable, buffer_limit, batch_size) do
      {:ok,
       %{
         bucket: Map.get(env, variable <> "_BUCKET", bucket),
         batch_size: batch_size,
         flush_interval: flush_interval,
         buffer_limit: buffer_limit
       }}
    end
  end

  defp influx(_env, false), do: {:ok, []}

  defp influx(env, true) do
    with {:ok, url} <- required(env, "INFLUX_URL"),
         :ok <- http_url("INFLUX_URL", url),
         {:ok, org} <- required(env, "INFLUX_ORG"),
         {:ok, token} <- required(env, "INFLUX_TOKEN") do
      {:ok, [influx_url: url, influx_org: org, influx_token: token]}
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

  # A smaller buffer could never fill a batch.
  defp at_least_batch(_variable, buffer_limit, batch_size) when buffer_limit >= batch_size,
    do: :ok

  defp at_least_batch(variable, buffer_limit, batch_size) do
    {:error,
     "#{variable}_BUFFER_LIMIT must be at least #{variable}_BATCH_SIZE, " <>
       "#{batch_size}, got #{buffer_limit}"}
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
