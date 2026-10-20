# ACS Service Client
# MQTT topic filters
# Copyright 2026 University of Sheffield

defmodule FPlus.MQTT.Filter do
  @moduledoc """
  MQTT topic filters: checking them and matching topics against them.
  """

  @doc """
  Whether a topic filter is valid: `+` and `#` must each be a whole level,
  and `#` must be the last.

      iex> FPlus.MQTT.Filter.valid?("spBv1.0/+/DDATA/#")
      true
      iex> FPlus.MQTT.Filter.valid?("spBv1.0/#/DDATA")
      false
  """
  @spec valid?(String.t()) :: boolean()
  def valid?(filter) when is_binary(filter) do
    filter != "" and String.valid?(filter) and valid_levels?(String.split(filter, "/"))
  end

  defp valid_levels?(["#"]), do: true

  defp valid_levels?([level | rest]) do
    (level == "+" or not String.contains?(level, ["+", "#"])) and
      (rest == [] or valid_levels?(rest))
  end

  @doc """
  Whether a topic matches a filter. Topics starting with `$` don't match
  a filter starting with a wildcard.

      iex> FPlus.MQTT.Filter.match?("spBv1.0/+/DDATA/#", "spBv1.0/Site_1/DDATA/Edge_1/Pump_3")
      true
      iex> FPlus.MQTT.Filter.match?("#", "$SYS/uptime")
      false
  """
  @spec match?(String.t(), String.t()) :: boolean()
  def match?(filter, topic) do
    if String.starts_with?(topic, "$") and String.starts_with?(filter, ["+", "#"]),
      do: false,
      else: match_levels?(String.split(filter, "/"), String.split(topic, "/"))
  end

  # "a/#" also matches "a" itself.
  defp match_levels?(["#"], _levels), do: true
  defp match_levels?(["+" | filter], [_level | topic]), do: match_levels?(filter, topic)
  defp match_levels?([level | filter], [level | topic]), do: match_levels?(filter, topic)
  defp match_levels?([], []), do: true
  defp match_levels?(_filter, _topic), do: false
end
