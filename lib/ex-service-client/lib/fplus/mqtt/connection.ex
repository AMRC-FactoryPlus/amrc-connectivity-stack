# ACS Service Client
# The process that owns the MQTT connection
# Copyright 2026 University of Sheffield

defmodule FPlus.MQTT.Connection do
  @moduledoc false

  # Owns one emqtt client at a time. Each connection attempt starts a new
  # client with a fresh Kerberos token, connects it in a task so this
  # process keeps answering calls, and checks the broker's reply before
  # using it. When the client is refused or exits, the attempt is retried
  # with backoff. Subscriptions live in the registry, so they are read
  # back and made again on every connect.

  use GenServer

  require Logger

  alias FPlus.Credentials
  alias FPlus.MQTT.Filter

  @min_retry :timer.seconds(1)
  @max_retry :timer.seconds(60)

  # emqtt waits this many seconds for CONNACK.
  @connect_timeout 10

  defstruct [
    :credentials,
    :http,
    :registry,
    :host,
    :port,
    :client_id,
    :client,
    :context,
    :connect_task,
    :connected_at,
    waiting_for_credentials: false,
    retry: @min_retry,
    filters: MapSet.new(),
    refused: %{}
  ]

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.fetch!(opts, :name))
  end

  @impl true
  def init(opts) do
    opts = Keyword.validate!(opts, [:name, :credentials, :http, :registry, :url, :client_id])

    # emqtt is linked to this process and exits when its connection ends.
    Process.flag(:trap_exit, true)

    # At debug level emqtt logs whole packets, including CONNECT with the
    # Kerberos token in it.
    :logger.set_module_level(:emqtt, :info)

    # Without a URL, the broker is looked up in the Directory on connect.
    {host, port} =
      case {opts[:url], opts[:http]} do
        {nil, nil} -> raise ArgumentError, "give :url, or :http to find the broker"
        {nil, _http} -> {nil, nil}
        {url, _http} -> parse_url!(url)
      end

    state = %__MODULE__{
      credentials: Keyword.fetch!(opts, :credentials),
      http: opts[:http],
      registry: Keyword.fetch!(opts, :registry),
      host: host,
      port: port,
      client_id:
        opts[:client_id] || "fplus-" <> Base.encode16(:crypto.strong_rand_bytes(8), case: :lower),
      filters: registered_filters(Keyword.fetch!(opts, :registry))
    }

    {:ok, state, {:continue, :connect}}
  end

  @impl true
  def handle_continue(:connect, state), do: {:noreply, connect(state)}

  @impl true
  def handle_call({:subscribe, filter}, _from, state) do
    state = %{state | filters: MapSet.put(state.filters, filter)}

    if connected?(state) do
      case subscribe(state.client, filter) do
        :ok -> {:reply, :ok, %{state | refused: Map.delete(state.refused, filter)}}
        {:error, _reason} = error -> {:reply, error, state}
      end
    else
      {:reply, :ok, state}
    end
  end

  def handle_call({:publish, topic, payload, opts}, _from, state) do
    if connected?(state) do
      pub_opts = [qos: 0, retain: opts[:retain]]
      {:reply, :emqtt.publish(state.client, topic, opts[:properties], payload, pub_opts), state}
    else
      {:reply, {:error, :not_connected}, state}
    end
  end

  def handle_call(:status, _from, state) do
    status = %{
      connected: connected?(state),
      connected_at: state.connected_at,
      broker: state.host && "#{state.host}:#{state.port}",
      subscriptions: state.filters |> MapSet.to_list() |> Enum.sort(),
      refused: state.refused
    }

    {:reply, status, state}
  end

  @impl true
  def handle_info(:connect, state), do: {:noreply, connect(state)}

  def handle_info({:publish, %{topic: topic, payload: payload} = message}, state) do
    deliver(state, topic, payload, Map.get(message, :properties) || %{})
    {:noreply, state}
  end

  def handle_info({ref, result}, %{connect_task: ref} = state) do
    Process.demonitor(ref, [:flush])
    {:noreply, connect_done(%{state | connect_task: nil}, result)}
  end

  def handle_info({:DOWN, ref, :process, _pid, reason}, %{connect_task: ref} = state) do
    {:noreply, connect_done(%{state | connect_task: nil}, {:error, {:connect_crashed, reason}})}
  end

  def handle_info({:disconnected, reason_code, properties}, state) do
    reason = {:disconnected, reason_code, properties[:"Reason-String"]}
    {:noreply, state |> drop() |> retry("the broker disconnected: #{inspect(reason)}")}
  end

  # While connecting, the connect task reports the failure.
  def handle_info({:EXIT, client, _reason}, %{client: client, connect_task: ref} = state)
      when is_reference(ref),
      do: {:noreply, state}

  def handle_info({:EXIT, client, reason}, %{client: client} = state) do
    {:noreply, %{state | client: nil} |> drop() |> retry("connection lost: #{inspect(reason)}")}
  end

  # Earlier clients, and connect tasks finishing.
  def handle_info({:EXIT, _pid, _reason}, state), do: {:noreply, state}

  @impl true
  def format_status(status) do
    # Until the broker's reply is checked, the context holds the session
    # key.
    Map.replace_lazy(status, :state, fn
      %__MODULE__{context: nil} = state -> state
      %__MODULE__{} = state -> %{state | context: :redacted}
      other -> other
    end)
  end

  # Connecting

  defp connect(%{client: client} = state) when is_pid(client), do: state

  defp connect(state) do
    with {:ok, state} <- find_broker(state),
         {:ok, token, context} <- Credentials.initiate(state.credentials, "mqtt", state.host) do
      start_client(state, token, context)
    else
      # Not logged in yet. That isn't the broker's fault, so check again
      # soon rather than backing off, and say so once.
      {:error, :unavailable} ->
        unless state.waiting_for_credentials do
          Logger.info("MQTT broker #{broker(state)}: waiting for Kerberos login")
        end

        Process.send_after(self(), :connect, @min_retry)
        %{state | waiting_for_credentials: true}

      {:error, {:no_broker, reason}} ->
        retry(state, "can't find the broker in the Directory: #{inspect(reason)}")

      {:error, reason} ->
        retry(state, "no Kerberos token: #{inspect(reason)}")
    end
  end

  defp find_broker(%{host: host} = state) when is_binary(host), do: {:ok, state}

  defp find_broker(state) do
    case FPlus.HTTP.service_url(state.http, FPlus.Service.mqtt()) do
      {:ok, url} ->
        case parse_url(url) do
          {:ok, host, port} -> {:ok, %{state | host: host, port: port}}
          :error -> {:error, {:no_broker, {:bad_url, url}}}
        end

      {:error, :unavailable} ->
        {:error, :unavailable}

      {:error, reason} ->
        {:error, {:no_broker, reason}}
    end
  end

  defp start_client(state, token, context) do
    {:ok, client} =
      :emqtt.start_link(
        host: String.to_charlist(state.host),
        port: state.port,
        proto_ver: :v5,
        clientid: state.client_id,
        clean_start: true,
        connect_timeout: @connect_timeout,
        owner: self(),
        properties: %{"Authentication-Method": "GSSAPI", "Authentication-Data": token}
      )

    task = Task.async(fn -> :emqtt.connect(client) end)

    %{
      state
      | client: client,
        context: context,
        connect_task: task.ref,
        waiting_for_credentials: false
    }
  end

  defp connect_done(state, {:ok, connack}) do
    reply = (connack || %{})[:"Authentication-Data"]

    case Credentials.verify(state.context, reply) do
      :ok ->
        Logger.info("Connected to MQTT broker #{broker(state)} as #{state.client_id}")

        %{state | context: nil, connected_at: DateTime.utc_now(), retry: @min_retry}
        |> subscribe_all()

      {:error, reason} ->
        state
        |> drop()
        |> retry("the broker failed mutual authentication: #{inspect(reason)}")
    end
  end

  defp connect_done(state, {:error, reason}) do
    state |> drop() |> retry("connection failed: #{inspect(reason)}")
  end

  defp retry(state, why) do
    Logger.warning("MQTT broker #{broker(state)}: #{why}; retrying in #{state.retry} ms")

    Process.send_after(self(), :connect, state.retry)
    %{state | retry: min(state.retry * 2, @max_retry)}
  end

  # Close the client, if there is one, and forget the connection.
  defp drop(state) do
    if is_pid(state.client) and Process.alive?(state.client) do
      catch_exit(:emqtt.stop(state.client))
    end

    %{state | client: nil, context: nil, connect_task: nil, connected_at: nil}
  end

  defp catch_exit(call) do
    call
  catch
    :exit, _reason -> :ok
  end

  defp connected?(state), do: state.connected_at != nil

  # Subscriptions

  defp registered_filters(registry) do
    registry
    |> Registry.select([{{:"$1", :_, :_}, [], [:"$1"]}])
    |> MapSet.new()
  end

  defp subscribe_all(state) do
    # Pick up subscriptions made while this process was restarting.
    filters = MapSet.union(state.filters, registered_filters(state.registry))

    refused =
      Enum.reduce(filters, %{}, fn filter, refused ->
        case subscribe(state.client, filter) do
          :ok -> refused
          {:error, {:refused, code}} -> Map.put(refused, filter, code)
        end
      end)

    for {filter, code} <- refused do
      Logger.error("MQTT broker refused the subscription to #{filter}: reason code #{code}")
    end

    %{state | filters: filters, refused: refused}
  end

  defp subscribe(client, filter) do
    case :emqtt.subscribe(client, filter, 0) do
      {:ok, _properties, [code]} when code < 0x80 -> :ok
      {:ok, _properties, [code]} -> {:error, {:refused, code}}
      {:error, reason} -> {:error, reason}
    end
  end

  # Send a message once to each process subscribed to a matching filter.
  defp deliver(state, topic, payload, properties) do
    state.filters
    |> Enum.filter(&Filter.match?(&1, topic))
    |> Enum.flat_map(&Registry.lookup(state.registry, &1))
    |> Enum.map(fn {pid, _value} -> pid end)
    |> Enum.uniq()
    |> Enum.each(&send(&1, {:fplus_mqtt, topic, payload, properties}))
  end

  defp broker(%{host: nil}), do: "(from the Directory)"
  defp broker(state), do: "#{state.host}:#{state.port}"

  defp parse_url!(url) do
    case parse_url(url) do
      {:ok, host, port} ->
        {host, port}

      :error ->
        raise ArgumentError, "the broker URL must be mqtt://host[:port], got: #{inspect(url)}"
    end
  end

  defp parse_url(url) do
    case URI.parse(url) do
      %URI{scheme: "mqtt", host: host, port: port} when is_binary(host) and host != "" ->
        {:ok, host, port || 1883}

      _other ->
        :error
    end
  end
end
