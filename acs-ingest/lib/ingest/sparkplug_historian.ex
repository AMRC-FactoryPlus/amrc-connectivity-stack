# ACS Ingest
# Writes Sparkplug device data to InfluxDB
# Copyright 2026 University of Sheffield

defmodule Ingest.SparkplugHistorian do
  @moduledoc """
  The Sparkplug historian: an `Ingest.Sparkplug.Consumer` that writes
  the metrics of each device's births and DATA to InfluxDB. It writes
  the points the JS historian (`historian-sparkplug`) wrote, except
  where those were wrong or crashed it.

  It runs in each edge node's process, so encoding is spread across the
  cores, and hands each message's lines to an `Ingest.Writer` in one
  call. Node births and node data are ignored, as in the JS.

  ## Points

  One point per metric. The measurement is the last segment of the
  metric's name, a colon, and a suffix for its birth's datatype. The
  only field is `value`:

  | Datatype | Suffix | Field |
  | --- | --- | --- |
  | Int8, Int16, Int32, Int64 | `i` | an integer |
  | UInt8, UInt16, UInt32, UInt64 | `u` | an unsigned integer |
  | Float, Double | `d` | a float |
  | Boolean | `b` | a boolean |
  | String, Text, UUID | `s` | the string |
  | DateTime | `s` | the integer as sent, in decimal |
  | Bytes, File | `s` | the bytes as UTF-8, with invalid sequences replaced by U+FFFD |

  The tags come from the birth, apart from `simulated` and `run_id`:

    * `group`, `node`, `device`
    * `path`: the name before its last `/`
    * `unit`: the birth metric's `engUnit`
    * `topLevelInstance`, `bottomLevelInstance`, `topLevelSchema`,
      `bottomLevelSchema`: see `Ingest.Sparkplug.Metadata`
    * `usesInstances`, `usesSchemas`: the top, a colon, and the chain
      joined with colons, as the JS writes them: a missing top is
      `null`, and an empty chain leaves the trailing colon (`null:`).
      `Ingest.Sparkplug.Metadata` makes them at the birth.
    * `simulated`: `true` when the metric's own `simulated` property is
      truthy as JS sees it (so the string `"no"` counts), and then
      `run_id`, its `run_id` property, if that is truthy too

  A tag with no value, or `""`, is left out.

  The timestamp is the metric's, else the payload's, else when the
  message arrived.

  ## Skips

  The rule is that a value is never written with the wrong type or the
  wrong value. A metric is skipped:

    * when its value is null, silently, as in the JS
    * when it, or its birth metric, is transient, with a debug log
    * when its DATA gives a datatype other than its birth's, with a
      warning. The JS coerced the value to the birth's type.
    * when its value isn't valid for its datatype, with a warning.
      `SparkplugB` leaves such a value raw: an integer out of range for
      its type, or a value in the wrong protobuf field.
    * when InfluxDB couldn't store the point, or would misread it, with
      a warning: NaN and the infinities, a timestamp outside 1677 to
      2262, and the lines `Ingest.LineProtocol` refuses
    * when a tag value from its birth isn't a string, with a warning
    * when its datatype is one the historian doesn't write: DataSets,
      Templates, property sets, arrays and unknown datatypes. A birth
      logs these once, and their DATA is skipped with a debug log.

  ## Options

    * `:writer` - required. The `Ingest.Writer` for the points.
  """

  @behaviour Ingest.Sparkplug.Consumer

  require Logger

  alias Ingest.LineProtocol
  alias Ingest.Sparkplug.Metadata
  alias Ingest.Sparkplug.Update
  alias Ingest.Writer
  alias SparkplugB.Metric
  alias SparkplugB.Property

  @signed [:int8, :int16, :int32, :int64]
  @unsigned [:uint8, :uint16, :uint32, :uint64]
  @floats [:float, :double]
  @strings [:string, :text, :uuid]
  @bytes [:bytes, :file]
  @written @signed ++ @unsigned ++ @floats ++ [:boolean, :date_time] ++ @strings ++ @bytes

  @impl true
  def handle_update(%Update{} = update, opts) do
    case points(update) do
      [] -> :ok
      lines -> Writer.write(Keyword.fetch!(opts, :writer), lines, length(lines))
    end
  end

  @doc """
  The points for an update, as lines of line protocol, each ending in a
  newline. It logs the metrics it skips.
  """
  @spec points(Update.t()) :: [iodata()]
  def points(%Update{address: %{device: nil}}), do: []

  def points(%Update{} = update) do
    {lines, unwritten} =
      Enum.reduce(update.metrics, {[], []}, fn {metric, meta}, {lines, unwritten} ->
        case point(update, metric, meta) do
          {:ok, line} ->
            {[line | lines], unwritten}

          {:unwritten, datatype} ->
            {lines, [{meta.name, datatype} | unwritten]}

          skipped ->
            log_skipped(skipped, update.address, meta.name)
            {lines, unwritten}
        end
      end)

    log_unwritten(update, Enum.reverse(unwritten))
    Enum.reverse(lines)
  end

  defp point(update, metric, meta) do
    with :ok <- not_null(metric),
         :ok <- not_transient(metric),
         :ok <- same_datatype(metric, meta),
         {:ok, suffix, field} <- field(meta.datatype, metric.value),
         {path, last} = split_name(meta.name),
         {:ok, tags} <- tags(update.address, path, metric, meta) do
      LineProtocol.encode(
        last <> ":" <> suffix,
        tags,
        %{"value" => field},
        metric.timestamp || update.timestamp || update.received
      )
    end
  end

  defp log_skipped(:null, _address, _name), do: :ok

  defp log_skipped(:transient, address, name),
    do: Logger.debug("Skipped #{inspect(name)} from #{name(address)}: it is transient")

  defp log_skipped({:error, reason}, address, name),
    do: Logger.warning("Skipped #{inspect(name)} from #{name(address)}: #{reason}")

  defp not_null(%Metric{value: nil}), do: :null
  defp not_null(_metric), do: :ok

  defp not_transient(%Metric{is_transient: true}), do: :transient
  defp not_transient(_metric), do: :ok

  defp same_datatype(%Metric{datatype: datatype}, %Metadata{datatype: datatype}), do: :ok

  defp same_datatype(metric, meta) do
    {:error,
     "its DATA has #{datatype(metric.datatype)}, but its birth has #{datatype(meta.datatype)}"}
  end

  defp field(type, v) when type in @signed and is_integer(v), do: {:ok, "i", {:integer, v}}
  defp field(type, v) when type in @unsigned and is_integer(v), do: {:ok, "u", {:unsigned, v}}

  defp field(type, v)
       when type in @floats and (is_float(v) or v in [:nan, :infinity, :"-infinity"]),
       do: {:ok, "d", {:float, v}}

  defp field(:boolean, v) when is_boolean(v), do: {:ok, "b", {:boolean, v}}
  defp field(type, v) when type in @strings and is_binary(v), do: {:ok, "s", {:string, v}}
  defp field(:date_time, v) when is_integer(v), do: {:ok, "s", {:string, Integer.to_string(v)}}

  defp field(type, v) when type in @bytes and is_binary(v),
    do: {:ok, "s", {:string, String.replace_invalid(v)}}

  defp field(type, v) when type in @written,
    do: {:error, "its value, #{inspect(v)}, isn't valid for #{datatype(type)}"}

  defp field(type, _v), do: {:unwritten, type}

  defp tags(address, path, metric, meta) do
    with :ok <- strings(meta),
         {:ok, simulated} <- simulated(metric.properties) do
      tags = %{
        "group" => address.group,
        "node" => address.node,
        "device" => address.device,
        "path" => path,
        "unit" => meta.unit,
        "topLevelInstance" => meta.instance.top,
        "bottomLevelInstance" => meta.instance.bottom,
        "usesInstances" => meta.instance.uses,
        "topLevelSchema" => meta.schema.top,
        "bottomLevelSchema" => meta.schema.bottom,
        "usesSchemas" => meta.schema.uses
      }

      {:ok, Map.merge(tags, simulated)}
    end
  end

  # The birth's UUIDs and unit are metric values, which can be of any
  # type, but tags are strings.
  defp strings(%Metadata{instance: instance, schema: schema, unit: unit}) do
    uuids = [
      instance.top,
      instance.bottom,
      schema.top,
      schema.bottom | instance.full ++ schema.full
    ]

    cond do
      not Enum.all?(uuids, &string_or_nil?/1) ->
        {:error, "a Schema_UUID or Instance_UUID in its birth isn't a string"}

      not string_or_nil?(unit) ->
        {:error, "its unit, #{inspect(unit)}, isn't a string"}

      true ->
        :ok
    end
  end

  defp string_or_nil?(value), do: is_binary(value) or is_nil(value)

  defp simulated(%{"simulated" => %Property{value: flag}} = properties) do
    if truthy?(flag), do: run_id(properties["run_id"]), else: {:ok, %{}}
  end

  defp simulated(_properties), do: {:ok, %{}}

  defp run_id(%Property{value: run}) when is_binary(run) or is_integer(run) do
    if truthy?(run),
      do: {:ok, %{"simulated" => "true", "run_id" => to_string(run)}},
      else: {:ok, %{"simulated" => "true"}}
  end

  defp run_id(%Property{value: run}) do
    if truthy?(run),
      do: {:error, "its run_id, #{inspect(run)}, isn't a string or an integer"},
      else: {:ok, %{"simulated" => "true"}}
  end

  defp run_id(nil), do: {:ok, %{"simulated" => "true"}}

  # Truthiness as in JS, for the values SparkplugB decodes.
  defp truthy?(value) when value in [nil, false, "", :nan], do: false
  defp truthy?(value) when is_number(value), do: value != 0
  defp truthy?(_value), do: true

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

  defp log_unwritten(_update, []), do: :ok

  defp log_unwritten(%Update{kind: :birth, address: address}, unwritten) do
    list =
      Enum.map_join(unwritten, ", ", fn {metric, type} ->
        "#{inspect(metric)} (#{datatype(type)})"
      end)

    Logger.info(
      "Won't write #{length(unwritten)} metrics of #{name(address)}, " <>
        "as the historian doesn't write their datatypes: #{list}"
    )
  end

  defp log_unwritten(%Update{address: address}, unwritten) do
    for {metric, type} <- unwritten do
      Logger.debug(
        "Skipped #{inspect(metric)} from #{name(address)}: " <>
          "the historian doesn't write #{datatype(type)}"
      )
    end

    :ok
  end

  defp datatype(nil), do: "no datatype"
  defp datatype(type), do: "datatype #{type}"

  defp name(%{group: group, node: node, device: device}), do: "#{group}/#{node}/#{device}"
end
