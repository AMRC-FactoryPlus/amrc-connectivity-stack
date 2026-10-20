# ACS Service Client
# MQTT connection to the Factory+ broker
# Copyright 2026 University of Sheffield

defmodule FPlus.MQTT do
  @moduledoc """
  An MQTT 5 connection to the Factory+ broker, authenticated with
  Kerberos.

  Add it to a supervision tree after `FPlus.Credentials`:

      children = [
        {FPlus.Credentials, name: MyApp.Credentials, principal: ..., keytab: ...},
        {FPlus.MQTT,
         name: MyApp.MQTT,
         credentials: MyApp.Credentials,
         url: "mqtt://mqtt.acs.localhost:1883"}
      ]

  The connection is made after the process starts, so a broker that is
  down doesn't stop the application starting. Each attempt
  authenticates with a fresh token from the credentials process, because
  the broker refuses a token it has seen before, and checks the broker's
  reply before using the connection. Failed attempts and dropped
  connections are retried with backoff.

  A process subscribes with `subscribe/2` and then receives
  `{:fplus_mqtt, topic, payload, properties}` messages. Subscriptions are
  held in a registry owned by the subscribing processes, so they are
  made again after every reconnect, and end when the subscriber exits.

  ## Options

    * `:name` - required. An atom naming the connection for the other
      functions.
    * `:credentials` - required. The `FPlus.Credentials` process.
    * `:url` - required. The broker, such as
      `"mqtt://mqtt.acs.localhost:1883"`. Its host is also the Kerberos
      service host (`mqtt@host`). Only `mqtt://` is supported so far.
    * `:client_id` - the MQTT client ID. Defaults to a random one.
  """

  use Supervisor

  alias FPlus.MQTT.Connection
  alias FPlus.MQTT.Filter

  @type option ::
          {:name, atom()}
          | {:credentials, GenServer.server()}
          | {:url, String.t()}
          | {:client_id, String.t()}

  @doc "Start the connection's supervisor."
  @spec start_link([option()]) :: Supervisor.on_start()
  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: Keyword.fetch!(opts, :name))
  end

  @impl true
  def init(opts) do
    name = Keyword.fetch!(opts, :name)
    connection_opts = Keyword.merge(opts, name: connection(name), registry: registry(name))

    children = [
      {Registry, keys: :duplicate, name: registry(name)},
      {Connection, connection_opts}
    ]

    # The connection reads the subscriptions from the registry, so if the
    # registry restarts, so does the connection.
    Supervisor.init(children, strategy: :rest_for_one)
  end

  @doc """
  Subscribe the calling process to a topic filter, at QoS 0.

  Returns `:ok` once the broker has accepted the subscription, or
  straight away if the connection is down: the subscription is then made
  when it connects. Returns `{:error, {:refused, reason_code}}` if the
  broker refuses it, and the caller is not subscribed.
  """
  @spec subscribe(atom(), String.t()) :: :ok | {:error, term()}
  def subscribe(name, filter) do
    unless Filter.valid?(filter),
      do: raise(ArgumentError, "invalid topic filter: #{inspect(filter)}")

    {:ok, _owner} = Registry.register(registry(name), filter, nil)

    case GenServer.call(connection(name), {:subscribe, filter}) do
      :ok ->
        :ok

      {:error, _reason} = error ->
        Registry.unregister_match(registry(name), filter, nil)
        error
    end
  end

  @doc """
  Publish a message at QoS 0.

  Returns `{:error, :not_connected}` if the connection is down. The
  options are `:properties`, MQTT 5 publish properties such as
  `%{"User-Property": [{"key", "value"}]}`, and `:retain`.
  """
  @spec publish(atom(), String.t(), iodata(), keyword()) :: :ok | {:error, term()}
  def publish(name, topic, payload, opts \\ []) do
    opts = Keyword.validate!(opts, properties: %{}, retain: false)
    GenServer.call(connection(name), {:publish, topic, payload, opts})
  end

  @doc """
  Whether the connection is up, since when, and its subscriptions.
  """
  @spec status(atom()) :: %{
          connected: boolean(),
          connected_at: DateTime.t() | nil,
          subscriptions: [String.t()],
          refused: %{String.t() => non_neg_integer()}
        }
  def status(name), do: GenServer.call(connection(name), :status)

  # Strings, not aliases: Connection here would be FPlus.MQTT.Connection.
  defp registry(name), do: Module.concat(name, "Registry")
  defp connection(name), do: Module.concat(name, "Connection")
end
