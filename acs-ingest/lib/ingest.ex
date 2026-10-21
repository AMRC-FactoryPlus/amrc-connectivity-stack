# ACS Ingest
# The service's supervision tree
# Copyright 2026 University of Sheffield

defmodule Ingest do
  @moduledoc """
  The ACS ingestion service. It replaces the JS Sparkplug historian, and
  later the UNS ingester and UNS historian, as parts of one application
  that share a Factory+ client.

  This is the top of its supervision tree, in order:

    * `Ingest.Writers` - a supervisor of the `Ingest.Writer`s, one per
      InfluxDB bucket in use, and their `Finch` pool, `Ingest.Finch`.
      The Sparkplug historian's writer is `Ingest.Writers.Sparkplug`.
    * `FPlus` - the Factory+ client, named `Ingest.FPlus`
    * `Ingest.Sparkplug` - the Sparkplug path, when the Sparkplug
      historian is on

  The parts subscribe through the client's MQTT connection, and a client
  that restarts has lost their subscriptions, so the strategy is
  `:rest_for_one`: the parts restart after the client. The writers come
  first, so that a client restart keeps their buffers, and so that they
  stop last and write what the parts gave them. `Ingest.Writers` is
  `:one_for_one`, so a writer that crashes restarts on its own.

  The configuration comes from `Ingest.Config`.
  """

  use Supervisor

  alias Ingest.Config
  alias Ingest.Writer

  @fplus Ingest.FPlus
  @finch Ingest.Finch
  @sparkplug_writer Ingest.Writers.Sparkplug

  # Fail a connection to InfluxDB quickly, and retry, rather than wait
  # Mint's default 30 s.
  @connect_timeout 5_000

  @doc "Start the service's supervisor."
  @spec start_link(Config.t()) :: Supervisor.on_start()
  def start_link(%Config{} = config) do
    Supervisor.start_link(__MODULE__, config, name: __MODULE__)
  end

  @impl true
  def init(%Config{} = config) do
    children = writers(config) ++ [{FPlus, [name: @fplus] ++ config.fplus} | parts(config)]
    Supervisor.init(children, strategy: :rest_for_one)
  end

  defp writers(%Config{sparkplug_historian: false}), do: []

  defp writers(config) do
    pools = %{default: [conn_opts: [transport_opts: [timeout: @connect_timeout]]]}
    children = [{Finch, name: @finch, pools: pools}, writer(config, @sparkplug_writer)]

    [
      %{
        id: Ingest.Writers,
        type: :supervisor,
        start:
          {Supervisor, :start_link, [children, [strategy: :one_for_one, name: Ingest.Writers]]}
      }
    ]
  end

  defp writer(config, name) do
    {Writer,
     name: name,
     finch: @finch,
     url: config.influx_url,
     org: config.influx_org,
     bucket: config.influx_bucket,
     token: config.influx_token,
     batch_size: config.batch_size,
     flush_interval: config.flush_interval,
     buffer_limit: config.buffer_limit}
  end

  # No consumers yet: the Sparkplug historian will be the first.
  defp parts(config) do
    if config.sparkplug_historian do
      [
        {Ingest.Sparkplug,
         name: Ingest.Sparkplug,
         subscribe: &FPlus.MQTT.subscribe(FPlus.mqtt(@fplus), &1),
         rebirth: &FPlus.CmdEsc.rebirth(FPlus.http(@fplus), &1)}
      ]
    else
      []
    end
  end
end
