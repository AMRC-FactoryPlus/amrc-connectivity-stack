# ACS Ingest
# The service's supervision tree
# Copyright 2026 University of Sheffield

defmodule Ingest do
  @moduledoc """
  The ACS ingestion service. It replaces the JS Sparkplug historian, and
  later the UNS ingester and UNS historian, as parts of one application
  that share a Factory+ client.

  This is the top of its supervision tree:

    * `FPlus` - the Factory+ client, named `Ingest.FPlus`
    * `Ingest.Sparkplug` - the Sparkplug path, when the Sparkplug
      historian is on

  The parts subscribe through the client's MQTT connection, and a client
  that restarts has lost their subscriptions, so the strategy is
  `:rest_for_one`: the parts restart after the client.

  The configuration comes from `Ingest.Config`.
  """

  use Supervisor

  alias Ingest.Config

  @fplus Ingest.FPlus

  @doc "Start the service's supervisor."
  @spec start_link(Config.t()) :: Supervisor.on_start()
  def start_link(%Config{} = config) do
    Supervisor.start_link(__MODULE__, config, name: __MODULE__)
  end

  @impl true
  def init(%Config{} = config) do
    children = [{FPlus, [name: @fplus] ++ config.fplus} | parts(config)]
    Supervisor.init(children, strategy: :rest_for_one)
  end

  defp parts(config) do
    if config.sparkplug_historian, do: [{Ingest.Sparkplug, fplus: @fplus}], else: []
  end
end
