# ACS Ingest
# Writes the UNS to InfluxDB
# Copyright 2026 University of Sheffield

defmodule Ingest.UnsHistorian do
  @moduledoc """
  The UNS historian: an `Ingest.Uns.Consumer` that writes the messages
  under `UNS/v1` to InfluxDB. It writes the points the JS UNS historian
  it replaced wrote, except where those were wrong or crashed it.

  It runs in the UNS path's workers, so decoding and encoding are spread
  across the cores, and hands each message's lines to an
  `Ingest.Writer` in one call.

  ## Points

  One point per sample: the payload's, then each of its batch's, in
  order (see `Ingest.UnsPayload`). So when a batch entry has the
  payload's timestamp, InfluxDB keeps the entry's value, as with the JS.
  The measurement is the topic's last segment, a colon, and a suffix for
  the `Type` user property. The only field is `value`:

  | `Type` | Suffix | Field |
  | --- | --- | --- |
  | Int8, Int16, Int32, Int64 | `i` | an integer: a JSON integer, or a float with an integral value, such as `1e3` |
  | UInt8, UInt16, UInt32, UInt64 | `u` | an unsigned integer, the same |
  | Float, Double | `d` | a float: any JSON number |
  | Boolean | `b` | a JSON boolean |
  | Bytes, File | `s` | the bytes of Node's Buffer JSON, `{"type":"Buffer","data":[...]}`, as UTF-8 with invalid sequences replaced by U+FFFD; or as for a string |
  | anything else, or none | `s` | a string; a number as JS writes it, but an integer exactly; or a boolean as `true` or `false` |

  The tags come from the topic and the user properties:

    * `enterprise`, `site`, `area`, `workCenter`, `workUnit`: the topic's
      segments after `UNS/v1`, up to the first `Edge`, at most five.
      With no `Edge`, up to the last segment.
    * `path`: the segments after the first `Edge`, but the last, joined
      with `/`: the device and the metric's folders, such as
      `D1/Phases/1`. With no `Edge`, every segment but the last.
    * `topLevelInstance`, `bottomLevelInstance`, `usesInstances`: from
      `InstanceUUIDPath`, split at colons. The top is the first element,
      the bottom the last if there are three or more, and the uses the
      first, a colon and the rest. So a chain of one UUID, `i-top:i-a`,
      has no bottom, as in the JS.
    * `topLevelSchema`, `bottomLevelSchema`, `usesSchemas`: the same,
      from `SchemaUUIDPath`
    * `unit`: `Unit`
    * `simulated`: `true` when `Simulated` is `"true"`, and then
      `run_id`, `RunId`

  A tag with no value, or `""`, is left out.

  The timestamp is the sample's (see
  `Ingest.UnsPayload.parse_timestamp/1`), else, for a batch entry, the
  payload's, else when the message arrived. A falsy timestamp, as JS
  sees it, such as `""`, counts as none.

  ## Skips

  The rule is that a value is never written with the wrong type or the
  wrong value. A message is skipped, with a warning, when:

    * it has no user properties, or no `InstanceUUIDPath` or
      `SchemaUUIDPath`, or one of those the historian reads more than
      once. The JS crashed on most of these.
    * its payload isn't a JSON object, or has a batch that isn't a list
      of objects

  A sample with a `null` value is skipped silently, as in the JS. Other
  samples the historian can't write are skipped, with one warning for
  the message:

    * one with no value
    * one whose value isn't valid for its `Type`, as above. The JS
      coerced strings, booleans and arrays to numbers, so `""` was 0.
    * one whose timestamp isn't a string, or doesn't parse, or whose
      payload's timestamp doesn't, if it falls back to that
    * one InfluxDB couldn't store, or would misread: an integer out of
      range, an infinite float, a timestamp outside 1677 to 2262, and
      the lines `Ingest.LineProtocol` refuses

  ## Options

    * `:writer` - required. The `Ingest.Writer` for the points.
  """

  @behaviour Ingest.Uns.Consumer

  require Logger

  alias Ingest.JS
  alias Ingest.LineProtocol
  alias Ingest.UnsPayload
  alias Ingest.Writer

  @signed ~w(Int8 Int16 Int32 Int64)
  @unsigned ~w(UInt8 UInt16 UInt32 UInt64)
  @floats ~w(Float Double)
  @bytes ~w(Bytes File)

  # The user properties the historian reads.
  @read ~w(InstanceUUIDPath SchemaUUIDPath Unit Type Simulated RunId)

  @levels ~w(enterprise site area workCenter workUnit)

  @impl true
  def handle_message(topic, payload, properties, received, opts) do
    case points(topic, payload, properties, received) do
      [] -> :ok
      lines -> Writer.write(Keyword.fetch!(opts, :writer), lines, length(lines))
    end
  end

  @doc """
  The points for a message, as lines of line protocol, each ending in a
  newline. `properties` are the message's MQTT 5 properties, and
  `received` when it arrived, in nanoseconds since the epoch. It logs
  what it skips.
  """
  @spec points(String.t(), binary(), map(), integer()) :: [iodata()]
  def points(topic, payload, properties, received) do
    topic = String.replace_invalid(topic)

    with {:ok, props} <- user_properties(properties),
         {:ok, samples} <- UnsPayload.decode(payload) do
      lines(topic, props, samples, received)
    else
      {:error, reason} ->
        Logger.warning("Skipped a message on #{inspect(topic)}: #{reason}")
        []
    end
  end

  # The properties the historian reads, decoded as MQTT.js decodes
  # them, with invalid UTF-8 replaced.
  defp user_properties(properties) do
    pairs = Map.get(properties, :"User-Property", [])

    with [_ | _] <- pairs,
         {:ok, props} <- read(pairs),
         :ok <- required(props, "InstanceUUIDPath"),
         :ok <- required(props, "SchemaUUIDPath") do
      {:ok, props}
    else
      [] -> {:error, "it has no user properties"}
      error -> error
    end
  end

  defp read(pairs) do
    Enum.reduce_while(pairs, {:ok, %{}}, fn {key, value}, {:ok, props} ->
      cond do
        key not in @read ->
          {:cont, {:ok, props}}

        Map.has_key?(props, key) ->
          {:halt, {:error, "it has the user property #{key} more than once"}}

        true ->
          {:cont, {:ok, Map.put(props, key, String.replace_invalid(value))}}
      end
    end)
  end

  defp required(props, key) do
    if Map.has_key?(props, key), do: :ok, else: {:error, "it has no #{key} user property"}
  end

  defp lines(topic, props, [payload | batch], received) do
    segments = String.split(topic, "/")
    type = props["Type"]
    {suffix, kind} = kind(type)
    measurement = List.last(segments) <> ":" <> suffix
    tags = tags(segments, props)

    payload_time = timestamp(payload["timestamp"], {:ok, received})

    samples = [
      {payload, payload_time} | Enum.map(batch, &{&1, timestamp(&1["timestamp"], payload_time)})
    ]

    {lines, skipped} =
      Enum.reduce(samples, {[], []}, fn {sample, time}, {lines, skipped} ->
        case line(sample, time, kind, type, measurement, tags) do
          {:ok, line} -> {[line | lines], skipped}
          :null -> {lines, skipped}
          {:error, reason} -> {lines, [reason | skipped]}
        end
      end)

    log_skipped(topic, Enum.reverse(skipped), length(samples))
    Enum.reverse(lines)
  end

  defp line(sample, time, kind, type, measurement, tags) do
    with {:ok, value} <- value(sample),
         {:ok, ns} <- time,
         {:ok, field} <- field(kind, value, type) do
      LineProtocol.encode(measurement, tags, %{"value" => field}, ns)
    end
  end

  defp value(%{"value" => nil}), do: :null
  defp value(%{"value" => value}), do: {:ok, value}
  defp value(_sample), do: {:error, "it has no value"}

  # A falsy timestamp falls back.
  defp timestamp(timestamp, fallback) do
    cond do
      not JS.truthy?(timestamp) ->
        fallback

      not is_binary(timestamp) ->
        {:error, "its timestamp, #{brief(timestamp)}, isn't a string"}

      true ->
        case UnsPayload.parse_timestamp(timestamp) do
          {:ok, ns} -> {:ok, ns}
          :error -> {:error, "its timestamp, #{inspect(timestamp)}, isn't one JS would read"}
        end
    end
  end

  defp kind(type) when type in @signed, do: {"i", :integer}
  defp kind(type) when type in @unsigned, do: {"u", :unsigned}
  defp kind(type) when type in @floats, do: {"d", :float}
  defp kind("Boolean"), do: {"b", :boolean}
  defp kind(type) when type in @bytes, do: {"s", :bytes}
  defp kind(_type), do: {"s", :string}

  defp field(kind, v, _type) when kind in [:integer, :unsigned] and is_integer(v),
    do: {:ok, {kind, v}}

  defp field(kind, v, _type) when kind in [:integer, :unsigned] and is_float(v) and trunc(v) == v,
    do: {:ok, {kind, trunc(v)}}

  defp field(:float, v, _type) when is_float(v) or v in [:infinity, :"-infinity"],
    do: {:ok, {:float, v}}

  defp field(:float, v, _type) when is_integer(v), do: {:ok, {:float, float(v)}}
  defp field(:boolean, v, _type) when is_boolean(v), do: {:ok, {:boolean, v}}

  defp field(:bytes, %{"type" => "Buffer", "data" => data} = v, type) when is_list(data) do
    if Enum.all?(data, &(is_integer(&1) and &1 in 0..255)),
      do: {:ok, {:string, data |> :erlang.list_to_binary() |> String.replace_invalid()}},
      else: invalid(v, type)
  end

  defp field(kind, v, type) when kind in [:string, :bytes] do
    case JS.string(v) do
      {:ok, string} -> {:ok, {:string, string}}
      :error -> invalid(v, type)
    end
  end

  defp field(_kind, v, type), do: invalid(v, type)

  # An integer too big for a float is infinite, as in JS.
  defp float(n) do
    :erlang.float(n)
  rescue
    ArgumentError -> if n < 0, do: :"-infinity", else: :infinity
  end

  defp invalid(v, nil), do: {:error, "its value, #{brief(v)}, isn't valid with no Type"}
  defp invalid(v, type), do: {:error, "its value, #{brief(v)}, isn't valid for #{type}"}

  defp brief(term), do: inspect(term, limit: 5, printable_limit: 100, charlists: :as_lists)

  defp tags(segments, props) do
    {levels, path} = levels_and_path(segments)
    {instance_top, instance_bottom, instance_uses} = chain(props["InstanceUUIDPath"])
    {schema_top, schema_bottom, schema_uses} = chain(props["SchemaUUIDPath"])

    tags = %{
      "path" => path,
      "unit" => props["Unit"],
      "topLevelInstance" => instance_top,
      "bottomLevelInstance" => instance_bottom,
      "usesInstances" => instance_uses,
      "topLevelSchema" => schema_top,
      "bottomLevelSchema" => schema_bottom,
      "usesSchemas" => schema_uses
    }

    tags
    |> Map.merge(Map.new(Enum.zip(@levels, levels)))
    |> Map.merge(simulated(props))
  end

  defp levels_and_path(segments) do
    case Enum.find_index(segments, &(&1 == "Edge")) do
      nil ->
        body = Enum.drop(segments, -1)
        {body |> Enum.drop(2) |> Enum.take(5), Enum.join(body, "/")}

      edge ->
        levels = segments |> Enum.slice(2..(edge - 1)//1) |> Enum.take(5)
        {levels, segments |> Enum.slice((edge + 1)..-2//1) |> Enum.join("/")}
    end
  end

  defp chain(path) do
    [top | rest] = String.split(path, ":")
    bottom = if match?([_, _ | _], rest), do: List.last(rest)
    {top, bottom, top <> ":" <> Enum.join(rest, ":")}
  end

  defp simulated(%{"Simulated" => "true"} = props),
    do: %{"simulated" => "true", "run_id" => props["RunId"]}

  defp simulated(_props), do: %{}

  defp log_skipped(_topic, [], _count), do: :ok

  defp log_skipped(topic, [reason], 1),
    do: Logger.warning("Skipped the value on #{inspect(topic)}: #{reason}")

  defp log_skipped(topic, [reason], count),
    do: Logger.warning("Skipped 1 of #{count} values on #{inspect(topic)}: #{reason}")

  defp log_skipped(topic, [reason | _] = skipped, count) do
    Logger.warning(
      "Skipped #{length(skipped)} of #{count} values on #{inspect(topic)}; the first: #{reason}"
    )
  end
end
