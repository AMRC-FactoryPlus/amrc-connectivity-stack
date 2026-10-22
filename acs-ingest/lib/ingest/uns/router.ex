# ACS Ingest
# Routes UNS messages to their topic's worker
# Copyright 2026 University of Sheffield

defmodule Ingest.Uns.Router do
  @moduledoc """
  Subscribes to `UNS/v1/#` and hands each message, still encoded, to
  the worker for its topic. Every UNS message passes through it, so it
  does nothing else: it notes when the message arrived.

  Every message counts for `last_message/1`, which
  `Ingest.StallMonitor` checks.

  ## Options

    * `:name` - required.
    * `:subscribe` - required. A function that subscribes the calling
      process to a topic filter, returning `:ok` or `{:error, reason}`.
    * `:workers` - required. The `PartitionSupervisor` of
      `Ingest.Uns.Worker`s.
  """

  use GenServer

  alias Ingest.Uns.Worker

  @filter "UNS/v1/#"

  @doc "Start the router."
  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    opts = Keyword.validate!(opts, [:name, :subscribe, :workers])
    GenServer.start_link(__MODULE__, opts, name: Keyword.fetch!(opts, :name))
  end

  @doc """
  When the router last had a message, as
  `System.monotonic_time(:millisecond)`, or `nil` if it hasn't had one.
  """
  @spec last_message(GenServer.server()) :: integer() | nil
  def last_message(router), do: GenServer.call(router, :last_message)

  @impl true
  def init(opts) do
    state = Map.new(Keyword.take(opts, [:subscribe, :workers]))
    {:ok, Map.put(state, :last_message, nil), {:continue, :subscribe}}
  end

  @impl true
  def handle_continue(:subscribe, state) do
    case state.subscribe.(@filter) do
      :ok -> {:noreply, state}
      {:error, reason} -> {:stop, {:subscribe, reason}, state}
    end
  end

  @impl true
  def handle_info({:fplus_mqtt, topic, payload, properties}, state) do
    received = System.os_time(:nanosecond)
    Worker.handle(state.workers, topic, payload, properties, received)
    {:noreply, %{state | last_message: System.monotonic_time(:millisecond)}}
  end

  @impl true
  def handle_call(:last_message, _from, state), do: {:reply, state.last_message, state}
end
