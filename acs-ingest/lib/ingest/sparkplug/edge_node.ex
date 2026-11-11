# ACS Ingest
# The process for one Sparkplug edge node
# Copyright 2026 University of Sheffield

defmodule Ingest.Sparkplug.EdgeNode do
  @moduledoc """
  The process for one Sparkplug edge node and its devices. The router
  sends it the node's messages still encoded; it decodes them, keeps the
  node's births in a `SparkplugB.Host`, and hands the resolved metrics
  to the consumers as `Ingest.Sparkplug.Update`s.

  Timestamps are decoded with `timestamp_unit: :auto`, because ACS edge
  agents send nanoseconds where Sparkplug says milliseconds.

  When a device sends DATA before its birth has been seen, it asks the
  device to rebirth, in a task so the request never holds up messages.
  As in the JS historian, it never asks a node to rebirth.

  It is temporary: if it crashes, the router starts a new one with the
  node's next message, which asks for a rebirth.

  ## Options

    * `:name`, `:key` - required. Its registered name, and the node's
      `{group, node}`.
    * `:consumers` - required. `{module, opts}` pairs; see
      `Ingest.Sparkplug.Consumer`.
    * `:rebirth` - required. A function that asks a device to rebirth,
      given its address, returning `:ok` or `{:error, reason}`.
    * `:tasks` - required. The `Task.Supervisor` for rebirth requests.
    * `:rebirth_interval` - passed to `SparkplugB.Host.new/1`.
  """

  use GenServer, restart: :temporary

  require Logger

  alias Ingest.Sparkplug.Metadata
  alias Ingest.Sparkplug.Update
  alias SparkplugB.Host

  @doc "Start an edge node's process."
  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    opts =
      Keyword.validate!(opts, [:name, :key, :consumers, :rebirth, :tasks, :rebirth_interval])

    GenServer.start_link(__MODULE__, opts, name: Keyword.fetch!(opts, :name))
  end

  @impl true
  def init(opts) do
    host_opts =
      if opts[:rebirth_interval], do: [rebirth_interval: opts[:rebirth_interval]], else: []

    {:ok,
     %{
       key: Keyword.fetch!(opts, :key),
       host: Host.new(host_opts),
       # A Metadata index for each node or device whose birth we have.
       births: %{},
       consumers: Keyword.fetch!(opts, :consumers),
       rebirth: Keyword.fetch!(opts, :rebirth),
       tasks: Keyword.fetch!(opts, :tasks)
     }}
  end

  @impl true
  def handle_info({:sparkplug, topic, binary, received}, state) do
    case SparkplugB.decode(binary, timestamp_unit: :auto) do
      {:ok, payload} ->
        now = System.monotonic_time(:millisecond)
        {host, events} = Host.handle(state.host, topic, payload, now)
        state = %{state | host: host}
        {:noreply, Enum.reduce(events, state, &handle_event(&1, &2, payload, received))}

      {:error, error} ->
        Logger.warning(
          "Ignored a payload on #{topic} that doesn't decode: #{Exception.message(error)}"
        )

        {:noreply, state}
    end
  end

  @impl true
  def format_status(status) do
    # The births can be large.
    Map.replace_lazy(status, :state, fn state ->
      %{state | host: :omitted, births: Map.keys(state.births)}
    end)
  end

  defp handle_event({:birth, address, metrics}, state, payload, received) do
    {pairs, nameless} = Metadata.from_birth(payload.uuid, metrics)
    log_birth(address, pairs, nameless)

    # A node's birth means its devices must be born again; Host has
    # forgotten them too.
    births = if address.device, do: state.births, else: %{}
    state = %{state | births: Map.put(births, address, Metadata.index(pairs))}

    notify(state, :birth, address, pairs, payload, received)
  end

  defp handle_event({:data, address, metrics}, state, payload, received) do
    case state.births do
      %{^address => index} ->
        notify(state, :data, address, with_metadata(metrics, index), payload, received)

      %{} ->
        state
    end
  end

  defp handle_event({:unknown_metric, address, metric}, state, _payload, _received) do
    which = if metric.alias, do: "alias #{metric.alias}", else: inspect(metric.name)
    Logger.warning("Ignored a metric from #{name(address)} that its birth doesn't have: #{which}")
    state
  end

  defp handle_event({:death, %{device: nil} = address}, state, _payload, _received) do
    Logger.info("Death of #{name(address)} and its devices")
    %{state | births: %{}}
  end

  defp handle_event({:death, address}, state, _payload, _received) do
    Logger.info("Death of #{name(address)}")
    %{state | births: Map.delete(state.births, address)}
  end

  defp handle_event({:stale_death, address}, state, _payload, _received) do
    Logger.info("Ignored a death of #{name(address)} from before its current birth")
    state
  end

  # The JS historian never asks a node to rebirth.
  defp handle_event({:rebirth, %{device: nil}}, state, _payload, _received), do: state

  defp handle_event({:rebirth, address}, state, _payload, _received) do
    Logger.info("Asking #{name(address)} to rebirth, as its data came before its birth")
    rebirth = state.rebirth

    Task.Supervisor.start_child(state.tasks, fn ->
      case rebirth.(address) do
        :ok ->
          :ok

        {:error, reason} ->
          Logger.warning("Asking #{name(address)} to rebirth failed: #{inspect(reason)}")
      end
    end)

    state
  end

  defp handle_event({:out_of_sequence, address, expected, got}, state, _payload, _received) do
    Logger.debug("#{name(address)} sent sequence number #{got}, expected #{expected}")
    state
  end

  # A metric whose birth metric had no name has no metadata; that was
  # logged with the birth.
  defp with_metadata(metrics, index) do
    for metric <- metrics, meta = Metadata.lookup(index, metric), do: {metric, meta}
  end

  defp notify(state, _kind, _address, [], _payload, _received), do: state

  defp notify(state, kind, address, pairs, payload, received) do
    update = %Update{
      kind: kind,
      address: address,
      metrics: pairs,
      timestamp: payload.timestamp,
      received: received
    }

    for {module, opts} <- state.consumers, do: module.handle_update(update, opts)
    state
  end

  defp log_birth(address, pairs, nameless) do
    {instance, schema} =
      case pairs do
        [{_metric, meta} | _] -> {meta.instance.top, meta.schema.top}
        [] -> {nil, nil}
      end

    Logger.info(
      "Birth of #{name(address)}, #{length(pairs)} metrics, " <>
        "instance #{inspect(instance)}, schema #{inspect(schema)}"
    )

    if nameless > 0 do
      Logger.warning(
        "Ignored #{nameless} metrics with no name in the birth of #{name(address)}, " <>
          "and will ignore their data"
      )
    end
  end

  defp name(%{group: group, node: node, device: nil}), do: "#{group}/#{node}"
  defp name(%{group: group, node: node, device: device}), do: "#{group}/#{node}/#{device}"
end
