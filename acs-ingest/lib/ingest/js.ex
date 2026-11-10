# ACS Ingest
# JS semantics the ported services depend on
# Copyright 2026 University of Sheffield

defmodule Ingest.JS do
  @moduledoc """
  The parts of JS's semantics that the services ported from JS depend
  on, for the values `SparkplugB` decodes: which values are truthy,
  what `String()` makes of a value, and what `trim()` strips.
  """

  # The code points JS's trim() strips, its WhiteSpace and
  # LineTerminator, besides U+0009 to U+000D and U+2000 to U+200A.
  @js_spaces [0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF]

  defguardp is_js_space(c) when c in 0x09..0x0D or c in 0x2000..0x200A or c in @js_spaces

  @doc """
  Whether JS counts a value as truthy. `nil`, `false`, `""`, zero and
  NaN are falsy; everything else is truthy, including the string
  `"false"`.
  """
  @spec truthy?(term()) :: boolean()
  def truthy?(value) when value in [nil, false, "", :nan], do: false
  def truthy?(value) when is_number(value), do: value != 0
  def truthy?(_value), do: true

  @doc """
  What JS's `String()` makes of a value: a string as it is, a number
  as `number/1` writes it, and a boolean as `"true"` or `"false"`.
  `:error` for other values, which JS would write as
  `"[object Object]"` or worse.
  """
  @spec string(term()) :: {:ok, String.t()} | :error
  def string(value) when is_binary(value), do: {:ok, value}
  def string(value) when is_boolean(value), do: {:ok, Atom.to_string(value)}

  def string(value) when is_number(value) or value in [:nan, :infinity, :"-infinity"],
    do: {:ok, number(value)}

  def string(_value), do: :error

  @doc """
  What JS's `trim()` makes of a string: the string without the
  whitespace and line terminators at its ends. JS strips U+FEFF but not
  U+0085, so this isn't `String.trim/1`.

      iex> Ingest.JS.trim("\\u00A0 Acme\\uFEFF")
      "Acme"
  """
  @spec trim(String.t()) :: String.t()
  def trim(string), do: string |> trim_leading() |> trim_trailing()

  defp trim_leading(<<c::utf8, rest::binary>>) when is_js_space(c), do: trim_leading(rest)
  defp trim_leading(string), do: string

  # The string up to the end of its last code point that isn't a space.
  defp trim_trailing(string), do: binary_part(string, 0, kept(string, byte_size(string), 0))

  defp kept(<<c::utf8, rest::binary>>, size, kept) do
    kept = if is_js_space(c), do: kept, else: size - byte_size(rest)
    kept(rest, size, kept)
  end

  # A byte that isn't UTF-8 isn't a space.
  defp kept(<<_byte, rest::binary>>, size, _kept), do: kept(rest, size, size - byte_size(rest))
  defp kept(<<>>, _size, kept), do: kept

  @doc """
  A number as JS writes it: an integer exactly, a float in its shortest
  form (`5`, `0.1`, `1e+21`, `1.5e-7`), with `-0.0` as `0`, and `NaN`,
  `Infinity` and `-Infinity`. JS would round an integer above 2^53.

      iex> Ingest.JS.number(1.0e21)
      "1e+21"
      iex> Ingest.JS.number(100.0)
      "100"
  """
  @spec number(number() | :nan | :infinity | :"-infinity") :: String.t()
  def number(n) when is_integer(n), do: Integer.to_string(n)
  def number(:nan), do: "NaN"
  def number(:infinity), do: "Infinity"
  def number(:"-infinity"), do: "-Infinity"
  def number(f) when f == 0, do: "0"
  def number(f) when f < 0, do: "-" <> number(-f)

  # ECMAScript's Number::toString, from the shortest digits that read
  # back as the same float and where the decimal point goes in them.
  def number(f) when is_float(f) do
    {digits, point} = shortest(f)
    format(digits, byte_size(digits), point)
  end

  defp format(digits, size, point) when size <= point and point <= 21,
    do: digits <> String.duplicate("0", point - size)

  defp format(digits, size, point) when 0 < point and point <= 21,
    do: binary_part(digits, 0, point) <> "." <> binary_part(digits, point, size - point)

  defp format(digits, _size, point) when -6 < point and point <= 0,
    do: "0." <> String.duplicate("0", -point) <> digits

  defp format(<<first, rest::binary>>, _size, point) do
    exponent = point - 1
    sign = if exponent < 0, do: "-", else: "+"
    mantissa = if rest == "", do: <<first>>, else: <<first, ?., rest::binary>>
    mantissa <> "e" <> sign <> Integer.to_string(abs(exponent))
  end

  # Erlang's shortest form has the same digits as JS's, written as
  # "1.0e21" or "100.0". Take the digits without leading or trailing
  # zeros, and where the decimal point goes in them.
  defp shortest(f) do
    {mantissa, exponent} =
      case String.split(:erlang.float_to_binary(f, [:short]), "e") do
        [mantissa] -> {mantissa, 0}
        [mantissa, exponent] -> {mantissa, String.to_integer(exponent)}
      end

    [whole, fraction] = String.split(mantissa, ".")
    digits = whole <> fraction
    significant = String.trim_leading(digits, "0")
    point = byte_size(whole) + exponent - (byte_size(digits) - byte_size(significant))
    {String.trim_trailing(significant, "0"), point}
  end
end
