# ACS Ingest
# Building the UNS payload for one topic
# Copyright 2026 University of Sheffield

defmodule Ingest.UnsPayload do
  @moduledoc """
  The JSON payload of a UNS message, as the JS UNS ingester's
  `buildUnsPayload` and `JSON.stringify` make it, byte for byte:

      {"timestamp":"2026-10-20T21:26:10.030000000Z","value":3,"batch":[...]}

  `value` and `timestamp` are the newest sample, which is what a reader
  of the current value expects. Any older samples go in `batch`, oldest
  first, as `{"timestamp":...,"value":...}`. Samples are sorted by
  timestamp, stably, so of equal timestamps the last given is the
  newest.

  Values are encoded as JS encodes them:

    * a float as `Ingest.JS.number/1` writes it: `5`, `0.1`, `1e+21`
    * `:nan`, `:infinity` and `:"-infinity"` as `null`
    * an integer exactly. JS rounds those above 2^53, as it makes them
      JS numbers.
    * a string with `"`, `\\` and the characters below U+0020 escaped,
      the control characters as `\\u00xx` in lowercase hex
    * `{:bytes, binary}` as Node encodes a Buffer,
      `{"type":"Buffer","data":[104,105]}`
  """

  import Bitwise

  alias Ingest.JS

  @typedoc "A timestamp in nanoseconds since the Unix epoch, and a value."
  @type sample :: {non_neg_integer(), value()}

  @type value ::
          integer()
          | float()
          | :nan
          | :infinity
          | :"-infinity"
          | boolean()
          | String.t()
          | {:bytes, binary()}

  @doc "The payload for a topic's samples, in the order they arrived."
  @spec build([sample(), ...]) :: iodata()
  def build([_ | _] = samples) do
    [{timestamp, value} | older] = samples |> Enum.sort_by(&elem(&1, 0)) |> Enum.reverse()

    batch =
      case older do
        [] -> []
        older -> [~s(,"batch":[), older |> Enum.reverse() |> Enum.map(&sample/1) |> join(), ?]]
      end

    [~s({"timestamp":"), iso8601(timestamp), ~s(","value":), value(value), batch, ?}]
  end

  @doc """
  An ISO 8601 timestamp with nanoseconds, from nanoseconds since the
  Unix epoch, such as `"2026-05-28T15:46:56.100923659Z"`. A year past
  9999 is written as JS writes it, `+010000`.
  """
  @spec iso8601(non_neg_integer()) :: String.t()
  def iso8601(ns) do
    seconds = div(ns, 1_000_000_000)

    {{year, month, day}, {hour, minute, second}} =
      :calendar.gregorian_seconds_to_datetime(seconds + 62_167_219_200)

    year = if year <= 9999, do: pad(year, 4), else: "+" <> pad(year, 6)

    "#{year}-#{pad(month, 2)}-#{pad(day, 2)}T#{pad(hour, 2)}:#{pad(minute, 2)}:#{pad(second, 2)}." <>
      pad(rem(ns, 1_000_000_000), 9) <> "Z"
  end

  @doc "A value as JSON."
  @spec value(value()) :: iodata()
  def value(v) when is_integer(v), do: Integer.to_string(v)
  def value(v) when is_float(v), do: JS.number(v)
  def value(v) when v in [:nan, :infinity, :"-infinity"], do: "null"
  def value(true), do: "true"
  def value(false), do: "false"
  def value(v) when is_binary(v), do: string(v)

  def value({:bytes, bytes}) do
    data = for <<byte <- bytes>>, do: Integer.to_string(byte)
    [~s({"type":"Buffer","data":[), join(data), "]}"]
  end

  defp sample({timestamp, value}),
    do: [~s({"timestamp":"), iso8601(timestamp), ~s(","value":), value(value), ?}]

  defp string(s), do: [?", escape(s, s, 0, 0, []), ?"]

  # Copy runs of characters that need no escape as slices of the
  # original.
  defp escape(<<c, rest::binary>>, s, from, len, acc) when c < 0x20 or c in [?", ?\\] do
    escape(rest, s, from + len + 1, 0, [acc, binary_part(s, from, len), escaped(c)])
  end

  defp escape(<<_c, rest::binary>>, s, from, len, acc), do: escape(rest, s, from, len + 1, acc)
  defp escape(<<>>, s, from, len, acc), do: [acc, binary_part(s, from, len)]

  defp escaped(?"), do: "\\\""
  defp escaped(?\\), do: "\\\\"
  defp escaped(?\b), do: "\\b"
  defp escaped(?\f), do: "\\f"
  defp escaped(?\n), do: "\\n"
  defp escaped(?\r), do: "\\r"
  defp escaped(?\t), do: "\\t"
  defp escaped(c), do: <<"\\u00", hex(c >>> 4), hex(c &&& 0xF)>>

  defp hex(n) when n < 10, do: ?0 + n
  defp hex(n), do: ?a + n - 10

  defp join(items), do: Enum.intersperse(items, ?,)

  defp pad(n, width), do: n |> Integer.to_string() |> String.pad_leading(width, "0")
end
