# ACS Ingest
# Publishes Sparkplug device data to the UNS
# Copyright 2026 University of Sheffield

defmodule Ingest.UnsIngester do
  @moduledoc """
  The UNS ingester: an `Ingest.Sparkplug.Consumer` that publishes the
  metrics of each device's births and DATA to the UNS, as JSON under
  `UNS/v1`. It publishes the messages the JS UNS ingester it replaced
  published, except where those were wrong or crashed it.

  It runs in each edge node's process, so encoding is spread across the
  cores. Node births and node data are ignored, as in the JS.

  ## Topics

      UNS/v1/<enterprise>/<site>/<area>/<work center>/<work unit>/Edge/<device>/<name>

  The levels are the device's ISA-95 hierarchy (see
  `Ingest.Sparkplug.Hierarchy`), from the enterprise down to the first
  it doesn't have. A level of `""` stays, as an empty level, and a
  number is written as JS writes it (`Ingest.JS.string/1`). `<name>`
  is the metric's name from its birth.

  ## Messages

  One message for each topic in a Sparkplug message, so the samples of
  a metric that a message has more than once go together, with the
  newest as the value (see `Ingest.UnsPayload`). A sample's timestamp
  is the metric's, else the payload's, else when the message arrived.
  The messages go in the order their topics first appear.

  The user properties come from the topic's first sample, in this
  order:

    * `InstanceUUID`, `SchemaUUID`: the birth's top-level UUIDs
    * `Transient`: `"true"` if the birth metric is transient, else
      `"false"`
    * `Unit`: the birth metric's `engUnit`, or `""`
    * `Type`: the birth's datatype, named as in Sparkplug, such as
      `Double` or `UInt64`
    * `InstanceUUIDPath`, `SchemaUUIDPath`: the top, a colon, and the
      chain joined with colons; see `Ingest.Sparkplug.Metadata`
    * `Simulated` and `RunId`, when the sample is marked as simulated;
      see `Ingest.Sparkplug.Simulated`

  ## Skips

  As in the JS, silently: a null value; a metric whose path (its name
  before the last `/`) contains `Device Control`, as a substring; and
  a metric whose last segment is `Instance_UUID` or `Schema_UUID`.
  Transient metrics are published.

  A device isn't published at all when its birth has no ISA-95
  enterprise (or a falsy one, as JS sees it, such as `""`), or no
  top-level `Instance_UUID` or `Schema_UUID`, or when its hierarchy
  would make topics MQTT doesn't allow. Its birth logs a warning, and
  its DATA is skipped silently.

  As in the historian, a value is never published with the wrong type
  or the wrong value. A sample is skipped, with a warning:

    * when its DATA gives a datatype other than its birth's
    * when its value isn't valid for its datatype
    * when its birth's UUIDs aren't strings, or its unit isn't a string
      or a number, or its `run_id` isn't a string or an integer
    * when its name would make a topic MQTT doesn't allow: with `+`,
      `#` or U+0000 in it, or longer than 65,535 bytes. The birth logs
      this, and DATA is skipped with a debug log.
    * when its datatype is one the UNS ingester doesn't publish:
      DataSets, Templates, property sets, arrays and unknown datatypes.
      A birth logs these once, and their DATA is skipped with a debug
      log.

  ## Options

    * `:publish` - required. A function that publishes a message at QoS
      0, given its topic, payload and user properties as `{key, value}`
      pairs, returning `:ok` or `{:error, reason}`.
  """

  @behaviour Ingest.Sparkplug.Consumer

  require Logger

  alias Ingest.JS
  alias Ingest.Sparkplug.Hierarchy
  alias Ingest.Sparkplug.Metadata
  alias Ingest.Sparkplug.Simulated
  alias Ingest.Sparkplug.Update
  alias Ingest.UnsPayload
  alias SparkplugB.Metric

  @signed [:int8, :int16, :int32, :int64]
  @unsigned [:uint8, :uint16, :uint32, :uint64]
  @floats [:float, :double]
  @strings [:string, :text, :uuid]
  @bytes [:bytes, :file]
  @published @signed ++ @unsigned ++ @floats ++ [:boolean, :date_time] ++ @strings ++ @bytes

  # The datatypes' names, as Tahu JS decodes them.
  @type_names %{
    int8: "Int8",
    int16: "Int16",
    int32: "Int32",
    int64: "Int64",
    uint8: "UInt8",
    uint16: "UInt16",
    uint32: "UInt32",
    uint64: "UInt64",
    float: "Float",
    double: "Double",
    boolean: "Boolean",
    string: "String",
    date_time: "DateTime",
    text: "Text",
    uuid: "UUID",
    bytes: "Bytes",
    file: "File"
  }

  @max_topic 65_535

  @typedoc "A message to publish: its topic, payload and user properties."
  @type message :: {String.t(), binary(), [{String.t(), String.t()}]}

  @impl true
  def handle_update(%Update{} = update, opts) do
    publish = Keyword.fetch!(opts, :publish)
    messages = messages(update)

    results =
      for {topic, payload, properties} <- messages, do: publish.(topic, payload, properties)

    case Enum.reject(results, &(&1 == :ok)) do
      [] ->
        :ok

      [error | _] = failed ->
        Logger.warning(
          "Couldn't publish #{length(failed)} of #{length(messages)} UNS messages " <>
            "for #{name(update.address)}: #{inspect(error)}"
        )
    end
  end

  @doc """
  The messages for an update, as `{topic, payload, user_properties}`.
  It logs what it skips.
  """
  @spec messages(Update.t()) :: [message()]
  def messages(%Update{address: %{device: nil}}), do: []
  def messages(%Update{metrics: []}), do: []

  def messages(%Update{metrics: [{_metric, meta} | _]} = update) do
    if update.kind == :birth, do: log_misplaced(update.address, meta.hierarchy)

    case prefix(update.address, meta) do
      {:ok, prefix} ->
        device_messages(update, prefix)

      {:skip, reason} ->
        if update.kind == :birth,
          do: Logger.warning("Won't publish #{name(update.address)} to the UNS: #{reason}")

        []
    end
  end

  # What a device's topics start with, from its birth. Every metric of
  # a birth has the same hierarchy and tops.
  defp prefix(address, %Metadata{hierarchy: hierarchy, instance: instance, schema: schema}) do
    with {:ok, levels} <- levels(hierarchy),
         :ok <- top(instance.top, "Instance_UUID"),
         :ok <- top(schema.top, "Schema_UUID") do
      prefix =
        IO.iodata_to_binary(["UNS/v1/", Enum.map(levels, &[&1, ?/]), "Edge/", address.device, ?/])

      if forbidden?(prefix),
        do: {:skip, "its topics would have +, # or U+0000 in them: #{inspect(prefix)}"},
        else: {:ok, prefix}
    end
  end

  defp levels(%Hierarchy{enterprise: nil}), do: {:skip, "its birth has no ISA-95 hierarchy"}

  defp levels(%Hierarchy{enterprise: enterprise} = hierarchy) do
    if JS.truthy?(enterprise) do
      hierarchy
      |> Hierarchy.levels()
      |> Enum.take_while(fn {_level, value} -> value != nil end)
      |> Enum.reduce_while({:ok, []}, &level_string/2)
    else
      {:skip, "its ISA-95 enterprise is #{inspect(enterprise)}"}
    end
  end

  defp level_string({level, value}, {:ok, strings}) do
    case JS.string(value) do
      {:ok, string} ->
        {:cont, {:ok, strings ++ [string]}}

      :error ->
        {:halt, {:skip, "its ISA-95 #{level}, #{inspect(value)}, isn't a string or a number"}}
    end
  end

  defp top(value, _name) when is_binary(value) and value != "", do: :ok

  defp top(value, name) do
    if JS.truthy?(value),
      do: {:skip, "its top-level #{name}, #{inspect(value)}, isn't a string"},
      else: {:skip, "its birth has no top-level #{name}"}
  end

  defp device_messages(update, prefix) do
    {topics, groups, unpublished} =
      Enum.reduce(update.metrics, {[], %{}, []}, fn {metric, meta}, acc ->
        case sample(update, prefix, metric, meta) do
          {:ok, topic, sample, properties} ->
            add_sample(acc, topic, sample, properties)

          {:unpublished, type} ->
            {topics, groups, unpublished} = acc
            {topics, groups, [{meta.name, type} | unpublished]}

          skipped ->
            log_skipped(skipped, update, meta.name)
            acc
        end
      end)

    log_unpublished(update, Enum.reverse(unpublished))

    for topic <- Enum.reverse(topics) do
      {properties, samples} = Map.fetch!(groups, topic)
      payload = samples |> Enum.reverse() |> UnsPayload.build() |> IO.iodata_to_binary()
      {topic, payload, properties}
    end
  end

  # The topics in the order they first appear, and each one's first
  # sample's properties and its samples, newest first.
  defp add_sample({topics, groups, unpublished}, topic, sample, properties) do
    case groups do
      %{^topic => {first, samples}} ->
        {topics, %{groups | topic => {first, [sample | samples]}}, unpublished}

      %{} ->
        {[topic | topics], Map.put(groups, topic, {properties, [sample]}), unpublished}
    end
  end

  defp sample(update, prefix, metric, meta) do
    {path, last} = split_name(meta.name)

    with :ok <- not_null(metric),
         :ok <- published_name(path, last),
         :ok <- same_datatype(metric, meta),
         {:ok, value} <- value(meta.datatype, metric.value),
         {:ok, topic} <- topic(prefix, path, last),
         {:ok, properties} <- properties(metric, meta) do
      timestamp = metric.timestamp || update.timestamp || update.received
      {:ok, topic, {timestamp, value}, properties}
    end
  end

  defp not_null(%Metric{value: nil}), do: :skip
  defp not_null(_metric), do: :ok

  defp published_name(path, last) do
    if String.contains?(path, "Device Control") or last in ["Instance_UUID", "Schema_UUID"],
      do: :skip,
      else: :ok
  end

  defp same_datatype(%Metric{datatype: datatype}, %Metadata{datatype: datatype}), do: :ok

  defp same_datatype(metric, meta) do
    {:error,
     "its DATA has #{datatype(metric.datatype)}, but its birth has #{datatype(meta.datatype)}"}
  end

  defp value(type, v) when type in @signed and is_integer(v), do: {:ok, v}
  defp value(type, v) when type in @unsigned and is_integer(v), do: {:ok, v}

  defp value(type, v)
       when type in @floats and (is_float(v) or v in [:nan, :infinity, :"-infinity"]),
       do: {:ok, v}

  defp value(:boolean, v) when is_boolean(v), do: {:ok, v}
  defp value(type, v) when type in @strings and is_binary(v), do: {:ok, v}
  defp value(:date_time, v) when is_integer(v), do: {:ok, v}
  defp value(type, v) when type in @bytes and is_binary(v), do: {:ok, {:bytes, v}}

  defp value(type, v) when type in @published,
    do: {:error, "its value, #{inspect(v)}, isn't valid for #{datatype(type)}"}

  defp value(type, _v), do: {:unpublished, type}

  defp topic(prefix, path, last) do
    topic = if path == "", do: prefix <> last, else: prefix <> path <> "/" <> last

    cond do
      byte_size(topic) > @max_topic -> {:bad_topic, "its topic is over #{@max_topic} bytes"}
      forbidden?(topic) -> {:bad_topic, "its topic would have +, # or U+0000 in it"}
      true -> {:ok, topic}
    end
  end

  defp forbidden?(topic), do: String.contains?(topic, ["+", "#", <<0>>])

  defp properties(metric, meta) do
    with {:ok, unit} <- unit(meta.unit),
         :ok <- uuid_paths(meta),
         {:ok, marker} <- Simulated.marker(metric.properties) do
      {:ok,
       [
         {"InstanceUUID", meta.instance.top},
         {"SchemaUUID", meta.schema.top},
         {"Transient", if(meta.transient, do: "true", else: "false")},
         {"Unit", unit},
         {"Type", Map.fetch!(@type_names, meta.datatype)},
         {"InstanceUUIDPath", meta.instance.uses},
         {"SchemaUUIDPath", meta.schema.uses}
         | marker_properties(marker)
       ]}
    end
  end

  defp unit(nil), do: {:ok, ""}

  defp unit(unit) do
    case JS.string(unit) do
      {:ok, string} -> {:ok, string}
      :error -> {:error, "its unit, #{inspect(unit)}, isn't a string or a number"}
    end
  end

  # `uses` is nil when a UUID in the chain isn't a string.
  defp uuid_paths(%Metadata{instance: %{uses: instances}, schema: %{uses: schemas}})
       when is_binary(instances) and is_binary(schemas),
       do: :ok

  defp uuid_paths(_meta),
    do: {:error, "a Schema_UUID or Instance_UUID in its birth isn't a string"}

  defp marker_properties(:real), do: []
  defp marker_properties({:simulated, nil}), do: [{"Simulated", "true"}]
  defp marker_properties({:simulated, run}), do: [{"Simulated", "true"}, {"RunId", run}]

  # The name before its last "/", or "" if it has none, and its last
  # segment.
  defp split_name(name) do
    case :binary.matches(name, "/") do
      [] ->
        {"", name}

      matches ->
        {at, 1} = List.last(matches)
        <<path::binary-size(^at), "/", last::binary>> = name
        {path, last}
    end
  end

  defp log_skipped(:skip, _update, _name), do: :ok

  defp log_skipped({:error, reason}, update, name),
    do: Logger.warning("Skipped #{inspect(name)} from #{name(update.address)}: #{reason}")

  defp log_skipped({:bad_topic, reason}, %Update{kind: :birth} = update, name) do
    Logger.warning(
      "Won't publish #{inspect(name)} from #{name(update.address)} to the UNS: #{reason}"
    )
  end

  defp log_skipped({:bad_topic, reason}, update, name),
    do: Logger.debug("Skipped #{inspect(name)} from #{name(update.address)}: #{reason}")

  defp log_misplaced(_address, %Hierarchy{misplaced: []}), do: :ok

  defp log_misplaced(address, %Hierarchy{misplaced: paths}) do
    Logger.warning(
      "Ignored the Hierarchy-v1 schema at #{Enum.map_join(paths, ", ", &inspect/1)} " <>
        "in the birth of #{name(address)}: it isn't under Device_Information/ISA95_Hierarchy"
    )
  end

  defp log_unpublished(_update, []), do: :ok

  defp log_unpublished(%Update{kind: :birth, address: address}, unpublished) do
    list =
      Enum.map_join(unpublished, ", ", fn {metric, type} ->
        "#{inspect(metric)} (#{datatype(type)})"
      end)

    Logger.info(
      "Won't publish #{length(unpublished)} metrics of #{name(address)} to the UNS, " <>
        "as it doesn't publish their datatypes: #{list}"
    )
  end

  defp log_unpublished(%Update{address: address}, unpublished) do
    for {metric, type} <- unpublished do
      Logger.debug(
        "Skipped #{inspect(metric)} from #{name(address)}: " <>
          "the UNS ingester doesn't publish #{datatype(type)}"
      )
    end

    :ok
  end

  defp datatype(nil), do: "no datatype"
  defp datatype(type), do: "datatype #{type}"

  defp name(%{group: group, node: node, device: device}), do: "#{group}/#{node}/#{device}"
end
