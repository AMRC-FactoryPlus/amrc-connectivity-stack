# ACS Ingest
# One part of the service, with its own Factory+ client
# Copyright 2026 University of Sheffield

defmodule Ingest.Part do
  @moduledoc """
  One part of the service, such as the Sparkplug historian, as a
  subtree of its own. It has its own `FPlus` client, so its own
  principal, keytab and MQTT connection, and the processes that do its
  work on that client.

  Its children, in order:

    * `Ingest.StallMonitor`, unless both its checks are off. It
      restarts this part's client, and only this part's.
    * `FPlus`, named `<name>.FPlus`
    * the part's own children, which subscribe through the client

  The strategy is `:rest_for_one`: the children after the client lose
  their subscriptions when it restarts, so they restart with it, and
  the stall monitor, before it, keeps counting. The monitor is
  significant: when it gives up, the part stops, and as the part is
  significant in `Ingest`, so does the service.

  ## Options

    * `:name` - required. The part's supervisor, and the prefix for
      its children's names.
    * `:part` - required. The part's name in its logs' metadata, such
      as `:sparkplug_historian`.
    * `:fplus` - required. Options for `FPlus`, apart from `:name`.
    * `:children` - required. The part's own child specs.
    * `:last_message` - required. A function returning when the part
      last had a message; see `Ingest.StallMonitor`.
    * `:stall_timeout`, `:connect_timeout` - in ms, or `nil`; see
      `Ingest.StallMonitor`.
  """

  use Supervisor

  @doc false
  def child_spec(opts) do
    %{
      id: Keyword.fetch!(opts, :name),
      start: {__MODULE__, :start_link, [opts]},
      type: :supervisor,
      restart: :transient,
      significant: true
    }
  end

  @doc "Start a part's supervisor."
  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts) do
    opts =
      Keyword.validate!(opts, [
        :name,
        :part,
        :fplus,
        :children,
        :last_message,
        :stall_timeout,
        :connect_timeout
      ])

    Supervisor.start_link(__MODULE__, opts, name: Keyword.fetch!(opts, :name))
  end

  @doc "The name of a part's `FPlus` client."
  @spec fplus(atom()) :: atom()
  def fplus(name), do: Module.concat(name, "FPlus")

  @impl true
  def init(opts) do
    name = Keyword.fetch!(opts, :name)

    children =
      monitor(name, opts) ++
        [{FPlus, [name: fplus(name)] ++ Keyword.fetch!(opts, :fplus)}] ++
        Keyword.fetch!(opts, :children)

    Supervisor.init(children, strategy: :rest_for_one, auto_shutdown: :any_significant)
  end

  defp monitor(name, opts) do
    if opts[:stall_timeout] || opts[:connect_timeout] do
      fplus = fplus(name)
      mqtt = FPlus.mqtt(fplus)

      [
        {Ingest.StallMonitor,
         name: Module.concat(name, "StallMonitor"),
         part: Keyword.fetch!(opts, :part),
         stall_timeout: opts[:stall_timeout],
         connect_timeout: opts[:connect_timeout],
         last_message: Keyword.fetch!(opts, :last_message),
         connected?: fn -> subscribed?(FPlus.MQTT.status(mqtt)) end,
         restart: fn -> Supervisor.stop(fplus, {:shutdown, :restart}) end}
      ]
    else
      []
    end
  end

  # Connected, with subscriptions, none of them refused.
  defp subscribed?(%{connected: true, subscriptions: [_ | _], refused: refused}),
    do: map_size(refused) == 0

  defp subscribed?(_status), do: false
end
