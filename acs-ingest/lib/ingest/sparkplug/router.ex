# ACS Ingest
# Routes Sparkplug messages to their edge node's process
# Copyright 2026 University of Sheffield

defmodule Ingest.Sparkplug.Router do
  @moduledoc """
  Subscribes to `spBv1.0/#` and sends each message, still encoded, to
  the process for its edge node, starting one if needed. Every Sparkplug
  message passes through it, so it does nothing else: it parses the
  topic and notes when the message arrived.

  A topic that isn't a valid Sparkplug topic is logged and dropped, and
  host `STATE` messages are dropped.

  ## Options

    * `:name` - required.
    * `:subscribe` - required. A function that subscribes the calling
      process to a topic filter, returning `:ok` or `{:error, reason}`.
    * `:registry`, `:nodes` - required. The `Registry` of edge node
      processes, by `{group, node}`, and their `DynamicSupervisor`.
    * `:node_opts` - required. Options for each
      `Ingest.Sparkplug.EdgeNode`, apart from its name and key.
  """

  use GenServer

  require Logger

  alias Ingest.Sparkplug.EdgeNode
  alias SparkplugB.Topic

  @filter "spBv1.0/#"

  @doc "Start the router."
  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    opts = Keyword.validate!(opts, [:name, :subscribe, :registry, :nodes, :node_opts])
    GenServer.start_link(__MODULE__, opts, name: Keyword.fetch!(opts, :name))
  end

  @impl true
  def init(opts) do
    state = Map.new(Keyword.take(opts, [:subscribe, :registry, :nodes, :node_opts]))
    {:ok, state, {:continue, :subscribe}}
  end

  @impl true
  def handle_continue(:subscribe, state) do
    case state.subscribe.(@filter) do
      :ok -> {:noreply, state}
      {:error, reason} -> {:stop, {:subscribe, reason}, state}
    end
  end

  @impl true
  def handle_info({:fplus_mqtt, name, payload, _properties}, state) do
    received = System.os_time(:nanosecond)

    case Topic.parse(name) do
      {:ok, %Topic{type: :state}} ->
        :ok

      {:ok, topic} ->
        route(state, topic, payload, received)

      {:error, :invalid_topic} ->
        Logger.warning("Ignored a message on #{inspect(name)}, which isn't a Sparkplug topic")
    end

    {:noreply, state}
  end

  defp route(state, topic, payload, received) do
    key = {topic.group, topic.node}

    case edge_node(state, key) do
      {:ok, pid} ->
        send(pid, {:sparkplug, topic, payload, received})

      {:error, reason} ->
        Logger.error(
          "Dropped a message from #{topic.group}/#{topic.node}: " <>
            "its process didn't start: #{inspect(reason)}"
        )
    end
  end

  defp edge_node(state, key) do
    case Registry.lookup(state.registry, key) do
      [{pid, _value}] -> {:ok, pid}
      [] -> start_edge_node(state, key)
    end
  end

  defp start_edge_node(state, key) do
    opts = [name: {:via, Registry, {state.registry, key}}, key: key] ++ state.node_opts

    case DynamicSupervisor.start_child(state.nodes, {EdgeNode, opts}) do
      {:ok, pid} -> {:ok, pid}
      {:error, {:already_started, pid}} -> {:ok, pid}
      {:error, reason} -> {:error, reason}
    end
  end
end
