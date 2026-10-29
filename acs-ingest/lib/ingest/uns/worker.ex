# ACS Ingest
# Hands UNS messages to the consumer
# Copyright 2026 University of Sheffield

defmodule Ingest.Uns.Worker do
  @moduledoc """
  One of the UNS path's workers, under its `PartitionSupervisor`. It
  hands each message it is given to the consumer, a `{module, opts}`
  pair (see `Ingest.Uns.Consumer`), in the order they arrive.
  """

  use GenServer

  @doc "Start a worker for a consumer."
  @spec start_link({module(), keyword()}) :: GenServer.on_start()
  def start_link({module, opts}) when is_atom(module) and is_list(opts),
    do: GenServer.start_link(__MODULE__, {module, opts})

  @doc """
  Hand a message to the worker for its topic, in `workers`, the
  `PartitionSupervisor`. It doesn't wait.
  """
  @spec handle(atom(), String.t(), binary(), map(), integer()) :: :ok
  def handle(workers, topic, payload, properties, received) do
    GenServer.cast(
      {:via, PartitionSupervisor, {workers, topic}},
      {:message, topic, payload, properties, received}
    )
  end

  @impl true
  def init(consumer), do: {:ok, consumer}

  @impl true
  def handle_cast({:message, topic, payload, properties, received}, {module, opts} = consumer) do
    module.handle_message(topic, payload, properties, received, opts)
    {:noreply, consumer}
  end
end
