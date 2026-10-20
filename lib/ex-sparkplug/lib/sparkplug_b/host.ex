# ACS Sparkplug B
# The state a Sparkplug host application keeps
# Copyright 2026 University of Sheffield

defmodule SparkplugB.Host do
  @moduledoc """
  The state a Sparkplug host application keeps about the nodes and
  devices it hears from: their births, so the metrics in their DATA
  messages can be resolved, and when to ask for a rebirth.

  It is plain data with no processes. Give each message to `handle/4`,
  which returns the new state and a list of events for the application
  to act on:

    * `{:birth, address, metrics}` - a node or device was born, with
      these metrics. A birth's values are also current data.
    * `{:data, address, metrics}` - DATA, with each metric's name,
      alias, datatype and transient flag filled in from the birth, and
      its value converted.
    * `{:unknown_metric, address, metric}` - a DATA metric the birth
      doesn't have, which is left out of `:data`.
    * `{:death, address}` - a node or device died. A node's death also
      ends its devices.
    * `{:stale_death, address}` - a node death from an earlier session,
      whose `bdSeq` doesn't match the current birth, so it is ignored.
    * `{:rebirth, address}` - DATA came from a node or device with no
      known birth: ask it for one, for example with Command Escalation.
      This is sent at most once per interval for each address.
    * `{:out_of_sequence, address, expected, got}` - a message from a
      node didn't have the next sequence number. This is only reported.

  An address is a map with `:group`, `:node` and `:device`, which is
  `nil` for the node itself.

  A device birth is accepted even if its node's birth hasn't been seen,
  as a host application usually starts after its nodes have.
  """

  alias SparkplugB.Metric
  alias SparkplugB.Payload
  alias SparkplugB.Topic

  # How long to wait before asking the same address to rebirth again, in
  # milliseconds. Picked at random between the two, so that hosts don't
  # all ask at once.
  @rebirth_interval {5_000, 10_000}

  defstruct nodes: %{}, rebirths: %{}, rebirth_interval: @rebirth_interval

  @type address :: %{group: String.t(), node: String.t(), device: String.t() | nil}

  @type event ::
          {:birth, address(), [Metric.t()]}
          | {:data, address(), [Metric.t()]}
          | {:unknown_metric, address(), Metric.t()}
          | {:death, address()}
          | {:stale_death, address()}
          | {:rebirth, address()}
          | {:out_of_sequence, address(), non_neg_integer(), non_neg_integer()}

  @opaque t :: %__MODULE__{}

  @doc """
  An empty state.

  ## Options

    * `:rebirth_interval` - how long to wait before asking the same
      address to rebirth again, in milliseconds. A `{min, max}` tuple
      picks at random between the two. Defaults to 5 to 10 seconds.
  """
  @spec new(keyword()) :: t()
  def new(opts \\ []) do
    opts = Keyword.validate!(opts, rebirth_interval: @rebirth_interval)
    %__MODULE__{rebirth_interval: opts[:rebirth_interval]}
  end

  @doc """
  Handle a message. `now` is the time in milliseconds, from any clock
  that only goes forwards, such as `System.monotonic_time(:millisecond)`.
  """
  @spec handle(t(), Topic.t(), Payload.t(), integer()) :: {t(), [event()]}
  def handle(host, %Topic{} = topic, %Payload{} = payload, now) do
    {host, events} = check_sequence(host, topic, payload)
    {host, more} = handle_type(host, topic, payload, now)
    {host, events ++ more}
  end

  @doc """
  The metrics a node or device was born with, or `nil` if its birth
  hasn't been seen.
  """
  @spec birth(t(), address()) :: [Metric.t()] | nil
  def birth(host, address) do
    case entry(host, address) do
      nil -> nil
      %{metrics: metrics} -> metrics
    end
  end

  # Messages

  defp handle_type(host, %Topic{type: :nbirth} = topic, payload, _now) do
    address = address(topic)

    node = %{
      birth: born(payload.metrics),
      metrics: payload.metrics,
      bd_seq: bd_seq(payload),
      seq: payload.seq,
      # A node's birth means its devices must be born again.
      devices: %{}
    }

    host = put_in(host.nodes[node_key(topic)], node)
    {forget_rebirth(host, address), [{:birth, address, payload.metrics}]}
  end

  defp handle_type(host, %Topic{type: :dbirth} = topic, payload, _now) do
    address = address(topic)
    device = %{birth: born(payload.metrics), metrics: payload.metrics}

    host =
      update_node(host, topic, fn node ->
        put_in(node.devices[topic.device], device)
      end)

    {forget_rebirth(host, address), [{:birth, address, payload.metrics}]}
  end

  defp handle_type(host, %Topic{type: type} = topic, payload, now)
       when type in [:ndata, :ddata] do
    address = address(topic)

    case entry(host, address) do
      nil -> ask_rebirth(host, address, now)
      %{birth: birth} -> {host, resolve(address, birth, payload.metrics)}
    end
  end

  defp handle_type(host, %Topic{type: :ndeath} = topic, payload, _now) do
    address = address(topic)

    case host.nodes[node_key(topic)] do
      nil ->
        {host, []}

      %{bd_seq: born} ->
        dying = bd_seq(payload)

        if born != nil and dying != nil and born != dying do
          {host, [{:stale_death, address}]}
        else
          {%{host | nodes: Map.delete(host.nodes, node_key(topic))}, [{:death, address}]}
        end
    end
  end

  defp handle_type(host, %Topic{type: :ddeath} = topic, _payload, _now) do
    address = address(topic)

    case entry(host, address) do
      nil ->
        {host, []}

      _device ->
        host = update_node(host, topic, &%{&1 | devices: Map.delete(&1.devices, topic.device)})
        {host, [{:death, address}]}
    end
  end

  # Commands and host state aren't a host application's business.
  defp handle_type(host, _topic, _payload, _now), do: {host, []}

  # Every message from a node, except its death, carries the next
  # sequence number, 0 to 255. Its birth starts again.
  defp check_sequence(host, %Topic{type: type} = topic, %Payload{seq: seq})
       when type in [:ndata, :dbirth, :ddata, :ddeath] and is_integer(seq) do
    case host.nodes[node_key(topic)] do
      %{seq: last} = node when is_integer(last) ->
        expected = rem(last + 1, 256)
        host = put_in(host.nodes[node_key(topic)], %{node | seq: seq})

        if seq == expected,
          do: {host, []},
          else: {host, [{:out_of_sequence, address(%{topic | device: nil}), expected, seq}]}

      %{} = node ->
        {put_in(host.nodes[node_key(topic)], %{node | seq: seq}), []}

      nil ->
        {host, []}
    end
  end

  defp check_sequence(host, _topic, _payload), do: {host, []}

  # Rebirths

  defp ask_rebirth(host, address, now) do
    case host.rebirths do
      %{^address => until} when now < until ->
        {host, []}

      _ ->
        until = now + interval(host.rebirth_interval)
        {put_in(host.rebirths[address], until), [{:rebirth, address}]}
    end
  end

  defp forget_rebirth(host, address), do: %{host | rebirths: Map.delete(host.rebirths, address)}

  defp interval({min, max}), do: min + :rand.uniform(max - min + 1) - 1
  defp interval(ms) when is_integer(ms), do: ms

  # Births

  # Index a birth's metrics by alias and by name: DATA may use either.
  defp born(metrics) do
    %{
      by_alias: for(%Metric{alias: a} = m <- metrics, a != nil, into: %{}, do: {a, m}),
      by_name: for(%Metric{name: n} = m <- metrics, n != nil, into: %{}, do: {n, m})
    }
  end

  defp resolve(address, birth, metrics) do
    {known, unknown} =
      Enum.reduce(metrics, {[], []}, fn metric, {known, unknown} ->
        case born_as(birth, metric) do
          nil -> {known, [{:unknown_metric, address, metric} | unknown]}
          born -> {[from_birth(metric, born) | known], unknown}
        end
      end)

    data = if known == [], do: [], else: [{:data, address, Enum.reverse(known)}]
    data ++ Enum.reverse(unknown)
  end

  defp born_as(birth, %Metric{alias: a}) when a != nil, do: birth.by_alias[a]
  defp born_as(birth, %Metric{name: n}) when n != nil, do: birth.by_name[n]
  defp born_as(_birth, _metric), do: nil

  defp from_birth(metric, born) do
    metric = Metric.with_datatype(metric, born.datatype)

    %{
      metric
      | name: metric.name || born.name,
        alias: metric.alias || born.alias,
        is_transient: metric.is_transient or born.is_transient
    }
  end

  # The bdSeq metric of a node's birth or death.
  defp bd_seq(%Payload{metrics: metrics}) do
    Enum.find_value(metrics, fn
      %Metric{name: "bdSeq", value: value} when is_integer(value) -> value
      _metric -> nil
    end)
  end

  # Addresses

  defp address(%Topic{group: group, node: node, device: device}),
    do: %{group: group, node: node, device: device}

  defp node_key(%{group: group, node: node}), do: {group, node}

  defp entry(host, %{device: nil} = address), do: host.nodes[node_key(address)]

  defp entry(host, address) do
    case host.nodes[node_key(address)] do
      nil -> nil
      node -> node.devices[address.device]
    end
  end

  # A device may be born before its node's birth has been seen.
  defp update_node(host, topic, fun) do
    node =
      host.nodes[node_key(topic)] ||
        %{birth: nil, metrics: nil, bd_seq: nil, seq: nil, devices: %{}}

    put_in(host.nodes[node_key(topic)], fun.(node))
  end
end
