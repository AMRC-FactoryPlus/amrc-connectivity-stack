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
    * `Ingest.StallMonitor` - restarts the client when messages stop or
      its connection stays down, unless both checks are off
    * `FPlus` - the Factory+ client, named `Ingest.FPlus`
    * `Ingest.Sparkplug` - the Sparkplug path, when the Sparkplug
      historian is on. Its edge node processes make the historian's
      points, with `Ingest.SparkplugHistorian`, and hand them to its
      writer.

  The parts subscribe through the client's MQTT connection, and a client
  that restarts has lost their subscriptions, so the strategy is
  `:rest_for_one`: the parts restart after the client. The writers come
  first, so that a client restart keeps their buffers, and so that they
  stop last and write what the parts gave them. `Ingest.Writers` is
  `:one_for_one`, so a writer that crashes restarts on its own.

  The stall monitor restarts the client by stopping it, so the parts
  restart with it. It comes before the client, so it keeps counting
  across those restarts. When restarting doesn't help, it stops, and
  as it is a significant child, the whole tree shuts down, and the
  application stops.

  The configuration comes from `Ingest.Config`.
  """

  use Supervisor

  alias Ingest.Config
  alias Ingest.Sparkplug.Router
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
    children =
      writers(config) ++
        monitor(config) ++ [{FPlus, [name: @fplus] ++ config.fplus} | parts(config)]

    Supervisor.init(children, strategy: :rest_for_one, auto_shutdown: :any_significant)
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

  defp monitor(%Config{stall_timeout: nil, connect_timeout: nil}), do: []

  defp monitor(config) do
    router = Ingest.Sparkplug.child(Ingest.Sparkplug, "Router")
    mqtt = FPlus.mqtt(@fplus)

    [
      {Ingest.StallMonitor,
       name: Ingest.StallMonitor,
       stall_timeout: config.stall_timeout,
       connect_timeout: config.connect_timeout,
       last_message: fn -> Router.last_message(router) end,
       connected?: fn -> subscribed?(FPlus.MQTT.status(mqtt)) end,
       restart: fn -> Supervisor.stop(@fplus, {:shutdown, :restart}) end}
    ]
  end

  # Connected, with subscriptions, none of them refused.
  defp subscribed?(%{connected: true, subscriptions: [_ | _], refused: refused}),
    do: map_size(refused) == 0

  defp subscribed?(_status), do: false

  defp parts(config) do
    if config.sparkplug_historian do
      [
        {Ingest.Sparkplug,
         name: Ingest.Sparkplug,
         subscribe: &FPlus.MQTT.subscribe(FPlus.mqtt(@fplus), &1),
         rebirth: &FPlus.CmdEsc.rebirth(FPlus.http(@fplus), &1),
         consumers: [{Ingest.SparkplugHistorian, writer: @sparkplug_writer}]}
      ]
    else
      []
    end
  end
end
