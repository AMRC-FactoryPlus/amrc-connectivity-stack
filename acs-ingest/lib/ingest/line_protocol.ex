# ACS Ingest
# InfluxDB line protocol
# Copyright 2026 University of Sheffield

defmodule Ingest.LineProtocol do
  @moduledoc ~S"""
  Encodes points as InfluxDB line protocol, with nanosecond timestamps.

  It escapes as the InfluxDB JS client (`@influxdata/influxdb-client`)
  does, so the Elixir historians write what the JS ones did:

    * measurements: comma, space, newline, carriage return and tab
      become `\,`, `\ `, `\n`, `\r` and `\t`; `=` and `"` stay as they
      are
    * tag keys, tag values and field keys: the same, and `=` becomes `\=`
    * string values: quoted, with `"` and `\` escaped; newlines and tabs
      stay as they are

  Other backslashes are written as they are. Tags and fields are sorted
  by key, and a tag whose value is `nil` or `""` is left out.

  Where the JS client would write a line that InfluxDB rejects or
  misreads, `encode/4` returns an error instead, so one bad point can't
  cost a batch. These are:

    * an integer outside int64, or an unsigned integer outside uint64
    * a float that is NaN or infinite
    * a timestamp outside InfluxDB's range, 1677 to 2262
    * a backslash at the end of a measurement, tag key, tag value or
      field key, or before a character that gets escaped there:
      InfluxDB would read it as escaping the escape
    * a measurement starting with `#`, which makes the line a comment
    * a series key longer than InfluxDB allows
    * an empty measurement, tag key or field key, or no fields
  """

  @typedoc """
  A field value, tagged with its line-protocol type. A float may also be
  one of the atoms `SparkplugB` decodes NaN and the infinities to; those
  are refused.
  """
  @type field_value ::
          {:integer, integer()}
          | {:unsigned, non_neg_integer()}
          | {:float, float() | :nan | :infinity | :"-infinity"}
          | {:boolean, boolean()}
          | {:string, String.t()}

  @type tags :: %{optional(String.t()) => String.t() | nil}
  @type fields :: %{optional(String.t()) => field_value()}

  @min_integer -0x8000000000000000
  @max_integer 0x7FFFFFFFFFFFFFFF
  @max_unsigned 0xFFFFFFFFFFFFFFFF

  # InfluxDB keeps the two lowest int64 values and the highest for
  # itself.
  @min_time @min_integer + 2
  @max_time @max_integer - 1

  # InfluxDB limits a series key to 65,535 bytes. 2.x builds the key
  # from the measurement, the tags and the field key, and adds the org
  # and bucket IDs and some separators, so leave room for those.
  @max_series_key 65_535 - 64

  # Measurements escape these. Tag keys, tag values and field keys also
  # escape `=`.
  @escaped ~c", \n\r\t"

  defguardp is_escaped(char, kind) when char in @escaped or (kind == :tag and char == ?=)

  @doc ~S"""
  Encodes one point as a line, ending in a newline.

  Returns the line as iodata, or an error saying why the point can't be
  written.

      iex> {:ok, line} =
      ...>   Ingest.LineProtocol.encode(
      ...>     "Speed:d",
      ...>     %{"device" => "Motor 1", "unit" => nil},
      ...>     %{"value" => {:float, 1.5}},
      ...>     1_700_000_000_000_000_000
      ...>   )
      iex> IO.iodata_to_binary(line)
      "Speed:d,device=Motor\\ 1 value=1.5 1700000000000000000\n"

      iex> Ingest.LineProtocol.encode("Speed:d", %{}, %{"value" => {:float, :nan}}, 0)
      {:error, ~s(field "value" is NaN)}
  """
  @spec encode(String.t(), tags(), fields(), integer()) :: {:ok, iodata()} | {:error, String.t()}
  def encode(measurement, tags, fields, timestamp)
      when is_binary(measurement) and is_map(tags) and is_map(fields) and is_integer(timestamp) do
    tags = tags |> Enum.reject(fn {_key, value} -> value in [nil, ""] end) |> Enum.sort()
    fields = Enum.sort(fields)

    with {:ok, measurement} <- measurement(measurement),
         {:ok, tags} <- map_ok(tags, &tag/1),
         {:ok, fields} <- fields(fields),
         :ok <- series_key(measurement, tags, fields),
         :ok <- timestamp(timestamp) do
      fields = Enum.map_intersperse(fields, ?,, fn {key, value} -> [key, ?=, value] end)
      {:ok, [measurement, tags, ?\s, fields, ?\s, Integer.to_string(timestamp), ?\n]}
    end
  end

  defp measurement(""), do: {:error, "measurement is empty"}

  defp measurement("#" <> _),
    do: {:error, "measurement starts with #, so InfluxDB would read the line as a comment"}

  defp measurement(name), do: escape(name, :measurement, "measurement")

  defp tag({key, value}) do
    with {:ok, escaped_key} <- key(key, "tag key"),
         {:ok, escaped_value} <- escape(value, :tag, {"tag", key}) do
      {:ok, [?,, escaped_key, ?=, escaped_value]}
    end
  end

  defp fields([]), do: {:error, "point has no fields"}
  defp fields(fields), do: map_ok(fields, &field/1)

  defp field({key, value}) do
    with {:ok, escaped_key} <- key(key, "field key"),
         {:ok, encoded} <- value(value, key) do
      {:ok, {escaped_key, encoded}}
    end
  end

  defp key("", what), do: {:error, "#{what} is empty"}
  defp key(key, what), do: escape(key, :tag, {what, key})

  defp value({:integer, n}, _key) when is_integer(n) and n >= @min_integer and n <= @max_integer,
    do: {:ok, [Integer.to_string(n), ?i]}

  defp value({:integer, n}, key) when is_integer(n),
    do: {:error, "field #{inspect(key)} is outside int64"}

  defp value({:unsigned, n}, _key) when is_integer(n) and n >= 0 and n <= @max_unsigned,
    do: {:ok, [Integer.to_string(n), ?u]}

  defp value({:unsigned, n}, key) when is_integer(n),
    do: {:error, "field #{inspect(key)} is outside uint64"}

  # The JS client writes -0.0 as 0.
  defp value({:float, f}, _key) when is_float(f) and f == 0.0, do: {:ok, "0.0"}
  defp value({:float, f}, _key) when is_float(f), do: {:ok, Float.to_string(f)}
  defp value({:float, :nan}, key), do: {:error, "field #{inspect(key)} is NaN"}

  defp value({:float, inf}, key) when inf in [:infinity, :"-infinity"],
    do: {:error, "field #{inspect(key)} is infinite"}

  defp value({:boolean, true}, _key), do: {:ok, "T"}
  defp value({:boolean, false}, _key), do: {:ok, "F"}

  defp value({:string, s}, _key) when is_binary(s),
    do: {:ok, [?", String.replace(s, ["\\", "\""], &["\\", &1]), ?"]}

  # 2.x makes a series key for each field.
  defp series_key(measurement, tags, fields) do
    longest_field = fields |> Enum.map(fn {key, _} -> IO.iodata_length(key) end) |> Enum.max()

    if IO.iodata_length([measurement, tags]) + longest_field > @max_series_key,
      do: {:error, "series key is longer than InfluxDB allows"},
      else: :ok
  end

  defp timestamp(ns) when ns >= @min_time and ns <= @max_time, do: :ok
  defp timestamp(_ns), do: {:error, "timestamp is outside InfluxDB's range"}

  # Escapes a measurement, or with `kind` `:tag`, a tag key, tag value
  # or field key. The result is iodata made of slices of the original.
  # `what` names the string for an error, and is only formatted then.
  defp escape(string, kind, what) do
    case escape(string, kind, string, 0, 0, []) do
      {:ok, escaped} ->
        {:ok, escaped}

      :backslash ->
        {:error,
         "#{describe(what)} has a backslash at the end or before a character that needs escaping"}
    end
  end

  defp describe({label, name}), do: "#{label} #{inspect(name)}"
  defp describe(label), do: label

  defp escape(<<?\\>>, _kind, _string, _from, _len, _acc), do: :backslash

  defp escape(<<?\\, char, _::binary>>, kind, _string, _from, _len, _acc)
       when is_escaped(char, kind),
       do: :backslash

  defp escape(<<char, rest::binary>>, kind, string, from, len, acc) when is_escaped(char, kind) do
    acc = [acc, binary_part(string, from, len), escape_char(char)]
    escape(rest, kind, string, from + len + 1, 0, acc)
  end

  defp escape(<<_, rest::binary>>, kind, string, from, len, acc),
    do: escape(rest, kind, string, from, len + 1, acc)

  defp escape(<<>>, _kind, string, from, len, acc),
    do: {:ok, [acc, binary_part(string, from, len)]}

  defp escape_char(?,), do: "\\,"
  defp escape_char(?\s), do: "\\ "
  defp escape_char(?=), do: "\\="
  defp escape_char(?\n), do: "\\n"
  defp escape_char(?\r), do: "\\r"
  defp escape_char(?\t), do: "\\t"

  # Like Enum.map/2 for a function returning {:ok, _}, stopping at the
  # first error.
  defp map_ok([], _fun), do: {:ok, []}

  defp map_ok([item | rest], fun) do
    with {:ok, result} <- fun.(item),
         {:ok, results} <- map_ok(rest, fun),
         do: {:ok, [result | results]}
  end
end
