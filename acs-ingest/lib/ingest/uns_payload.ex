# ACS Ingest
# The UNS payload: building it for one topic, and reading it
# Copyright 2026 University of Sheffield

defmodule Ingest.UnsPayload do
  @moduledoc """
  The JSON payload of a UNS message. `build/1` makes it as the JS UNS
  ingester's `buildUnsPayload` and `JSON.stringify` made it, byte for
  byte:

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

  `decode/1` and `parse_timestamp/1` read a payload as the JS UNS
  historian did, for the UNS historian.
  """

  import Bitwise

  alias Ingest.JS

  # Days from 0000-01-01 to the Unix epoch.
  @epoch_days 719_528

  defguardp is_digit(c) when c in ?0..?9

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

  @doc """
  Decodes a payload as the JS UNS historian's `JSON.parse` read it:
  invalid UTF-8 replaced with U+FFFD, of duplicate keys the last, and
  a number too big for a float as `:infinity` or `:"-infinity"`.
  Integers are exact.

  Returns the payload's object, then its batch's, in order, as maps
  with whatever keys they have. A `batch` of `null` counts as none.
  It's an error if the payload isn't a JSON object, or its batch isn't
  a list of objects.
  """
  @spec decode(binary()) :: {:ok, [map(), ...]} | {:error, String.t()}
  def decode(payload) do
    with {:ok, object} <- json(String.replace_invalid(payload)),
         {:ok, batch} <- batch(object) do
      {:ok, [object | batch]}
    end
  end

  defp json(text) do
    case JSON.decode(text, :ok, float: &json_float/1, object_finish: &json_object/2) do
      {object, :ok, ""} when is_map(object) -> {:ok, object}
      {_json, :ok, ""} -> {:error, "its payload isn't a JSON object"}
      {_json, :ok, _rest} -> {:error, "its payload isn't valid JSON: more follows the value"}
      {:error, reason} -> {:error, "its payload isn't valid JSON: #{inspect(reason)}"}
    end
  end

  # JSON allows numbers too big for a float, which JS reads as Infinity.
  defp json_float(text) do
    :erlang.binary_to_float(text)
  rescue
    ArgumentError -> if String.starts_with?(text, "-"), do: :"-infinity", else: :infinity
  end

  # Of duplicate keys, JS keeps the last, and OTP's json the first.
  defp json_object(pairs, acc), do: {Map.new(Enum.reverse(pairs)), acc}

  defp batch(%{"batch" => nil}), do: {:ok, []}

  defp batch(%{"batch" => batch}) when is_list(batch) do
    if Enum.all?(batch, &is_map/1),
      do: {:ok, batch},
      else: {:error, "its batch has an entry that isn't a JSON object"}
  end

  defp batch(%{"batch" => _batch}), do: {:error, "its batch isn't a list"}
  defp batch(_object), do: {:ok, []}

  @doc """
  Parses a timestamp to nanoseconds since the Unix epoch, as the JS UNS
  historian did, or returns `:error`.

  The forms are ECMAScript's date time format: `2026-10-20T21:26:10Z`,
  with a fraction of any length, without seconds, or with an offset
  such as `+01:00` instead of `Z`; or a date alone, `2026-10-20`,
  `2026-10` or `2026`. A year may be `+010000`. Without an offset it is
  UTC: JS reads a time without one as local time, which is UTC in a
  pod. `T24:00` is the next day, as in JS. A date must exist, where JS
  rolls `2026-02-31` over to 3 March.

  A timestamp ending in a fraction and `Z` keeps nine fractional digits,
  as the UNS ingester writes them; any other is cut to milliseconds, as
  JS's `Date` cuts it.

      iex> Ingest.UnsPayload.parse_timestamp("2026-10-20T21:26:10.123456789Z")
      {:ok, 1_792_531_570_123_456_789}
      iex> Ingest.UnsPayload.parse_timestamp("2026-10-20T22:26:10.123456+01:00")
      {:ok, 1_792_531_570_123_000_000}
  """
  @spec parse_timestamp(String.t()) :: {:ok, integer()} | :error
  def parse_timestamp(timestamp) when is_binary(timestamp) do
    case split_nanoseconds(timestamp) do
      # JS's Date reads the rest, with the Z, and it must be whole
      # seconds.
      {:ok, base, fraction} ->
        case milliseconds(base <> "Z") do
          {:ok, ms} when rem(ms, 1000) == 0 ->
            {:ok, div(ms, 1000) * 1_000_000_000 + digits(fraction, 9)}

          _invalid ->
            :error
        end

      :error ->
        with {:ok, ms} <- milliseconds(timestamp), do: {:ok, ms * 1_000_000}
    end
  end

  # As JS's /^(.+)\.(\d+)Z$/: what comes before a final "." and digits
  # and "Z", and the digits.
  defp split_nanoseconds(timestamp) do
    size = byte_size(timestamp) - 1

    with true <- size > 0,
         <<body::binary-size(^size), "Z">> <- timestamp,
         count when count > 0 <- trailing_digits(body, size),
         dot = size - count - 1,
         true <- dot > 0,
         <<base::binary-size(^dot), ?., fraction::binary>> <- body do
      {:ok, base, fraction}
    else
      _no -> :error
    end
  end

  defp trailing_digits(body, at) do
    if at > 0 and is_digit(:binary.at(body, at - 1)),
      do: trailing_digits(body, at - 1),
      else: byte_size(body) - at
  end

  # ECMAScript's date time format, to milliseconds since the epoch.
  defp milliseconds(string) do
    with {:ok, {year, month, day}, rest} <- date(string),
         true <- month in 1..12 and day in 1..Calendar.ISO.days_in_month(year, month),
         {:ok, ms_of_day, offset} <- time(rest) do
      days = Date.to_gregorian_days(Date.new!(year, month, day)) - @epoch_days
      {:ok, days * 86_400_000 + ms_of_day - offset * 60_000}
    else
      _invalid -> :error
    end
  end

  defp date(<<sign, year::binary-size(6), rest::binary>>) when sign in [?+, ?-] do
    case number(year) do
      {:ok, 0} when sign == ?- -> :error
      {:ok, n} when sign == ?- -> month_day(-n, rest)
      {:ok, n} -> month_day(n, rest)
      :error -> :error
    end
  end

  defp date(<<year::binary-size(4), rest::binary>>) do
    with {:ok, n} <- number(year), do: month_day(n, rest)
  end

  defp date(_string), do: :error

  defp month_day(year, <<?-, month::binary-size(2), rest::binary>>) do
    with {:ok, month} <- number(month), do: day(year, month, rest)
  end

  defp month_day(year, rest), do: {:ok, {year, 1, 1}, rest}

  defp day(year, month, <<?-, day::binary-size(2), rest::binary>>) do
    with {:ok, day} <- number(day), do: {:ok, {year, month, day}, rest}
  end

  defp day(year, month, rest), do: {:ok, {year, month, 1}, rest}

  # A date alone is UTC.
  defp time(""), do: {:ok, 0, 0}

  defp time(<<?T, hour::binary-size(2), ?:, minute::binary-size(2), rest::binary>>) do
    with {:ok, hour} <- number(hour),
         {:ok, minute} <- number(minute),
         {:ok, second, ms, rest} <- seconds(rest),
         {:ok, offset} <- offset(rest),
         true <- valid_time?(hour, minute, second, ms) do
      {:ok, ((hour * 60 + minute) * 60 + second) * 1000 + ms, offset}
    else
      _invalid -> :error
    end
  end

  defp time(_rest), do: :error

  defp seconds(<<?:, second::binary-size(2), ?., rest::binary>>) do
    {fraction, rest} = take_digits(rest, 0)

    with true <- fraction != "",
         {:ok, second} <- number(second),
         do: {:ok, second, digits(fraction, 3), rest}
  end

  defp seconds(<<?:, second::binary-size(2), rest::binary>>) do
    with {:ok, second} <- number(second), do: {:ok, second, 0, rest}
  end

  defp seconds(rest), do: {:ok, 0, 0, rest}

  # In minutes east of UTC. No offset is UTC.
  defp offset(""), do: {:ok, 0}
  defp offset("Z"), do: {:ok, 0}

  defp offset(<<sign, hour::binary-size(2), ?:, minute::binary-size(2)>>)
       when sign in [?+, ?-] do
    with {:ok, hour} when hour < 24 <- number(hour),
         {:ok, minute} when minute < 60 <- number(minute) do
      {:ok, if(sign == ?-, do: -1, else: 1) * (hour * 60 + minute)}
    else
      _invalid -> :error
    end
  end

  defp offset(_rest), do: :error

  defp valid_time?(24, 0, 0, 0), do: true
  defp valid_time?(hour, minute, second, _ms), do: hour < 24 and minute < 60 and second < 60

  defp take_digits(string, n) do
    case string do
      <<_::binary-size(^n), c, _::binary>> when is_digit(c) -> take_digits(string, n + 1)
      <<digits::binary-size(^n), rest::binary>> -> {digits, rest}
    end
  end

  # The first `width` digits of a fraction, padded with zeros.
  defp digits(fraction, width) do
    fraction
    |> binary_part(0, min(byte_size(fraction), width))
    |> String.pad_trailing(width, "0")
    |> String.to_integer()
  end

  defp number(digits), do: number(digits, 0)
  defp number(<<c, rest::binary>>, n) when is_digit(c), do: number(rest, n * 10 + c - ?0)
  defp number(<<>>, n), do: {:ok, n}
  defp number(_digits, _n), do: :error

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
