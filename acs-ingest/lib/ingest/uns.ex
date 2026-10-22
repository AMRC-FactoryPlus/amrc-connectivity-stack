# ACS Ingest
# The UNS path
# Copyright 2026 University of Sheffield

defmodule Ingest.Uns do
  @moduledoc """
  The UNS path: it reads `UNS/v1/#` and hands each message to a
  consumer, the UNS historian, in one of a pool of workers, so the
  consumer's work is spread across the cores. It runs when the UNS
  historian is on.

  Its children, in order:

    * a `PartitionSupervisor` of `Ingest.Uns.Worker`s. Each message
      goes to the worker for its topic, so each topic's messages are
      handled in the order they arrived.
    * `Ingest.Uns.Router`, which subscribes, and hands each message to
      its topic's worker

  The strategy is `:rest_for_one`, so the router restarts with the
  workers. A router that restarts subscribes again. A worker that
  crashes loses the messages waiting for it, and restarts on its own.

  ## Options

    * `:name` - required. Names the supervisor, and its children by
      suffixes, such as `<name>.Router`.
    * `:subscribe` - required. A function that subscribes the calling
      process to a topic filter, such as
      `&FPlus.MQTT.subscribe(mqtt, &1)`.
    * `:consumer` - required. A `{module, opts}` pair; see
      `Ingest.Uns.Consumer`.
    * `:partitions` - the number of workers. Default
      `System.schedulers_online/0`.
  """

  use Supervisor

  alias Ingest.Uns.Router
  alias Ingest.Uns.Worker

  @doc "Start the UNS path's supervisor."
  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts) do
    opts =
      Keyword.validate!(opts, [
        :name,
        :subscribe,
        :consumer,
        partitions: System.schedulers_online()
      ])

    Supervisor.start_link(__MODULE__, opts, name: Keyword.fetch!(opts, :name))
  end

  @impl true
  def init(opts) do
    name = Keyword.fetch!(opts, :name)

    children = [
      {PartitionSupervisor,
       child_spec: {Worker, Keyword.fetch!(opts, :consumer)},
       name: child(name, "Workers"),
       partitions: Keyword.fetch!(opts, :partitions)},
      {Router,
       name: child(name, "Router"),
       subscribe: Keyword.fetch!(opts, :subscribe),
       workers: child(name, "Workers")}
    ]

    Supervisor.init(children, strategy: :rest_for_one)
  end

  @doc "The name of one of the children: `\"Workers\"` or `\"Router\"`."
  @spec child(atom(), String.t()) :: atom()
  def child(name, suffix), do: Module.concat(name, suffix)
end
