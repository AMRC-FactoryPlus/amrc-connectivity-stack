# ACS Ingest
# The Sparkplug path
# Copyright 2026 University of Sheffield

defmodule Ingest.Sparkplug do
  @moduledoc """
  The Sparkplug path: it reads `spBv1.0/#` and keeps a process for each
  edge node, which decodes the node's messages, keeps its births, and
  hands the resolved metrics to the consumers. It runs when the
  Sparkplug historian is on.

  Its children, in order:

    * a `Registry` of the edge node processes, by `{group, node}`
    * a `Task.Supervisor` for rebirth requests
    * a `DynamicSupervisor` of `Ingest.Sparkplug.EdgeNode` processes
    * `Ingest.Sparkplug.Router`, which subscribes, and routes each
      message to its node's process, starting it if needed

  The strategy is `:rest_for_one`, so a process restarts with the ones
  that depend on it. A router that restarts subscribes again and keeps
  the edge nodes' processes. Those are temporary: one that crashes
  loses only its own node's births.

  ## Options

    * `:name` - required. Names the supervisor, and its children by
      suffixes, such as `<name>.Router`.
    * `:subscribe` - required. A function that subscribes the calling
      process to a topic filter, such as
      `&FPlus.MQTT.subscribe(mqtt, &1)`.
    * `:rebirth` - required. A function that asks a device to rebirth,
      given its address, such as `&FPlus.CmdEsc.rebirth(http, &1)`.
    * `:consumers` - `{module, opts}` pairs; see
      `Ingest.Sparkplug.Consumer`. Default none.
    * `:rebirth_interval` - passed to `SparkplugB.Host.new/1`.
  """

  use Supervisor

  alias Ingest.Sparkplug.Router

  @doc "Start the Sparkplug path's supervisor."
  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts) do
    opts =
      Keyword.validate!(opts, [:name, :subscribe, :rebirth, :rebirth_interval, consumers: []])

    Supervisor.start_link(__MODULE__, opts, name: Keyword.fetch!(opts, :name))
  end

  @impl true
  def init(opts) do
    name = Keyword.fetch!(opts, :name)

    node_opts =
      [
        consumers: opts[:consumers],
        rebirth: Keyword.fetch!(opts, :rebirth),
        tasks: child(name, "Tasks")
      ] ++ Keyword.take(opts, [:rebirth_interval])

    children = [
      {Registry, keys: :unique, name: child(name, "Registry")},
      {Task.Supervisor, name: child(name, "Tasks")},
      {DynamicSupervisor, name: child(name, "Nodes"), strategy: :one_for_one},
      {Router,
       name: child(name, "Router"),
       subscribe: Keyword.fetch!(opts, :subscribe),
       registry: child(name, "Registry"),
       nodes: child(name, "Nodes"),
       node_opts: node_opts}
    ]

    Supervisor.init(children, strategy: :rest_for_one)
  end

  @doc "The name of one of the children: `\"Registry\"`, `\"Nodes\"` or `\"Router\"`."
  @spec child(atom(), String.t()) :: atom()
  def child(name, suffix), do: Module.concat(name, suffix)
end
