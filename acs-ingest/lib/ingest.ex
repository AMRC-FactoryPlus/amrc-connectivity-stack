# ACS Ingest
# The service's supervision tree
# Copyright 2026 University of Sheffield

defmodule Ingest do
  @moduledoc """
  The ACS ingestion service. It replaces the JS Sparkplug historian, UNS
  ingester and UNS historian, as parts of one application.

  Each part is an `Ingest.Part`: a subtree with its own Factory+ client,
  logged in as the part's own principal, as the JS services each were,
  and its own stall monitor. The parts share the writers. This is the
  top of the tree, in order:

    * `Ingest.Writers` - a supervisor of the historians' `Ingest.Writer`s,
      one per part that writes, named after it (the Sparkplug historian's
      is `Ingest.Writers.SparkplugHistorian`), and their `Finch` pool,
      `Ingest.Finch`
    * a part per part that is on:
      * `Ingest.Parts.SparkplugHistorian`, whose Sparkplug path's edge
        node processes make the historian's points, with
        `Ingest.SparkplugHistorian`, and hand them to its writer
      * `Ingest.Parts.UnsIngester`, whose Sparkplug path's edge node
        processes make the UNS messages, with `Ingest.UnsIngester`, and
        publish them on the part's own MQTT connection
      * `Ingest.Parts.UnsHistorian`, whose UNS path's workers make the
        historian's points, with `Ingest.UnsHistorian`, and hand them to
        its writer

  The strategy is `:one_for_one`, so each part restarts on its own. The
  writers come first, so that they stop last and write what the parts
  gave them. A part that gives up stops: it is significant, so the
  whole tree then shuts down, and the application stops.

  The configuration comes from `Ingest.Config`.
  """

  use Supervisor

  alias Ingest.Config
  alias Ingest.Part
  alias Ingest.Sparkplug
  alias Ingest.Uns
  alias Ingest.Writer

  @finch Ingest.Finch

  # Fail a connection to InfluxDB quickly, and retry, rather than wait
  # Mint's default 30 s.
  @connect_timeout 5_000

  @doc "Start the service's supervisor."
  @spec start_link(Config.t()) :: Supervisor.on_start()
  def start_link(%Config{} = config) do
    Supervisor.start_link(__MODULE__, config, name: __MODULE__)
  end

  @doc "The name of a part's supervisor, such as `Ingest.Parts.SparkplugHistorian`."
  @spec part(atom()) :: atom()
  def part(name), do: Module.concat(Ingest.Parts, Macro.camelize(Atom.to_string(name)))

  @doc "The name of a part's writer, such as `Ingest.Writers.SparkplugHistorian`."
  @spec writer(atom()) :: atom()
  def writer(name), do: Module.concat(Ingest.Writers, Macro.camelize(Atom.to_string(name)))

  @impl true
  def init(%Config{} = config) do
    children = writers(config) ++ Enum.map(config.parts, &part_spec/1)
    Supervisor.init(children, strategy: :one_for_one, auto_shutdown: :any_significant)
  end

  defp writers(config) do
    case for(part <- config.parts, part.writer, do: writer_spec(config, part)) do
      [] ->
        []

      writers ->
        pools = %{default: [conn_opts: [transport_opts: [timeout: @connect_timeout]]]}
        children = [{Finch, name: @finch, pools: pools} | writers]

        [
          %{
            id: Ingest.Writers,
            type: :supervisor,
            start:
              {Supervisor, :start_link,
               [children, [strategy: :one_for_one, name: Ingest.Writers]]}
          }
        ]
    end
  end

  defp writer_spec(config, part) do
    {Writer,
     name: writer(part.name),
     finch: @finch,
     url: config.influx_url,
     org: config.influx_org,
     bucket: part.writer.bucket,
     token: config.influx_token,
     batch_size: part.writer.batch_size,
     flush_interval: part.writer.flush_interval,
     buffer_limit: part.writer.buffer_limit}
  end

  defp part_spec(%Config.Part{name: :sparkplug_historian} = config) do
    sparkplug_part(config, fn _fplus ->
      {Ingest.SparkplugHistorian, writer: writer(config.name)}
    end)
  end

  defp part_spec(%Config.Part{name: :uns_ingester} = config) do
    sparkplug_part(config, fn fplus ->
      mqtt = FPlus.mqtt(fplus)

      {Ingest.UnsIngester,
       publish: &FPlus.MQTT.publish(mqtt, &1, &2, properties: %{"User-Property": &3})}
    end)
  end

  defp part_spec(%Config.Part{name: :uns_historian} = config) do
    name = part(config.name)
    fplus = Part.fplus(name)
    uns = Module.concat(name, "Uns")
    router = Uns.child(uns, "Router")

    subtree(config, fn -> Uns.Router.last_message(router) end, [
      {Uns,
       name: uns,
       subscribe: &FPlus.MQTT.subscribe(FPlus.mqtt(fplus), &1),
       consumer: {Ingest.UnsHistorian, writer: writer(config.name)}}
    ])
  end

  # A part whose Sparkplug path hands its updates to one consumer, given
  # the name of the part's `FPlus`.
  defp sparkplug_part(config, consumer) do
    name = part(config.name)
    fplus = Part.fplus(name)
    sparkplug = Module.concat(name, "Sparkplug")
    router = Sparkplug.child(sparkplug, "Router")

    subtree(config, fn -> Sparkplug.Router.last_message(router) end, [
      {Sparkplug,
       name: sparkplug,
       subscribe: &FPlus.MQTT.subscribe(FPlus.mqtt(fplus), &1),
       rebirth: &FPlus.CmdEsc.rebirth(FPlus.http(fplus), &1),
       consumers: [consumer.(fplus)]}
    ])
  end

  # A part's subtree, given its own children and a function returning
  # when its router last had a message.
  defp subtree(config, last_message, children) do
    {Part,
     name: part(config.name),
     part: config.name,
     fplus: config.fplus,
     stall_timeout: config.stall_timeout,
     connect_timeout: config.connect_timeout,
     last_message: last_message,
     children: children}
  end
end
