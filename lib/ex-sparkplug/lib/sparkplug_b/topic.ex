# ACS Sparkplug B
# Sparkplug topic names
# Copyright 2026 University of Sheffield

defmodule SparkplugB.Topic do
  @moduledoc """
  Sparkplug B topic names.

  A topic is one of:

    * a node message, `spBv1.0/<group>/<type>/<node>`, where `type` is
      `:nbirth`, `:ndeath`, `:ndata` or `:ncmd`
    * a device message, `spBv1.0/<group>/<type>/<node>/<device>`, where
      `type` is `:dbirth`, `:ddeath`, `:ddata` or `:dcmd`
    * a host application's state, `spBv1.0/STATE/<host>`, type `:state`
      (Sparkplug 3.0)
    * the older form of host state, `STATE/<host>`, type `:legacy_state`
      (Sparkplug 2.x)

  `parse/1` reads a topic name and `to_string/1` writes one; topics also
  work with string interpolation.
  """

  import Kernel, except: [to_string: 1]

  @namespace "spBv1.0"

  @node_types %{"NBIRTH" => :nbirth, "NDEATH" => :ndeath, "NDATA" => :ndata, "NCMD" => :ncmd}

  @device_types %{
    "DBIRTH" => :dbirth,
    "DDEATH" => :ddeath,
    "DDATA" => :ddata,
    "DCMD" => :dcmd
  }

  @wire_types @node_types
              |> Map.merge(@device_types)
              |> Map.new(fn {wire, type} -> {type, wire} end)

  defstruct [:type, :group, :node, :device, :host]

  @type node_type :: :nbirth | :ndeath | :ndata | :ncmd
  @type device_type :: :dbirth | :ddeath | :ddata | :dcmd
  @type type :: node_type() | device_type() | :state | :legacy_state

  @type t :: %__MODULE__{
          type: type(),
          group: String.t() | nil,
          node: String.t() | nil,
          device: String.t() | nil,
          host: String.t() | nil
        }

  @doc """
  Parse a topic name.

      iex> SparkplugB.Topic.parse("spBv1.0/Site_1/DDATA/Edge_1/Pump_3")
      {:ok, %SparkplugB.Topic{type: :ddata, group: "Site_1", node: "Edge_1", device: "Pump_3"}}

      iex> SparkplugB.Topic.parse("spBv1.0/STATE/historian")
      {:ok, %SparkplugB.Topic{type: :state, host: "historian"}}

      iex> SparkplugB.Topic.parse("spBv1.0/Site_1/DDATA/Edge_1")
      {:error, :invalid_topic}

  Anything that isn't a valid Sparkplug B topic is an error, including
  IDs that are empty, aren't valid UTF-8 or contain `+` or `#`.
  """
  @spec parse(String.t()) :: {:ok, t()} | {:error, :invalid_topic}
  def parse(topic) when is_binary(topic) do
    topic
    |> String.split("/")
    |> from_levels()
    |> validate()
  end

  @doc """
  The topic name for a topic.

      iex> SparkplugB.Topic.to_string(%SparkplugB.Topic{type: :ncmd, group: "Site_1", node: "Edge_1"})
      "spBv1.0/Site_1/NCMD/Edge_1"
  """
  @spec to_string(t()) :: String.t()
  def to_string(%__MODULE__{type: :state, host: host}), do: "#{@namespace}/STATE/#{host}"
  def to_string(%__MODULE__{type: :legacy_state, host: host}), do: "STATE/#{host}"

  def to_string(%__MODULE__{type: type, group: group, node: node, device: nil}),
    do: Enum.join([@namespace, group, @wire_types[type], node], "/")

  def to_string(%__MODULE__{type: type, group: group, node: node, device: device}),
    do: Enum.join([@namespace, group, @wire_types[type], node, device], "/")

  defp from_levels([@namespace, "STATE", host]), do: %__MODULE__{type: :state, host: host}
  defp from_levels(["STATE", host]), do: %__MODULE__{type: :legacy_state, host: host}

  defp from_levels([@namespace, group, type, node]) when is_map_key(@node_types, type),
    do: %__MODULE__{type: @node_types[type], group: group, node: node}

  defp from_levels([@namespace, group, type, node, device])
       when is_map_key(@device_types, type),
       do: %__MODULE__{type: @device_types[type], group: group, node: node, device: device}

  defp from_levels(_levels), do: nil

  defp validate(nil), do: {:error, :invalid_topic}

  defp validate(topic) do
    if topic |> ids() |> Enum.all?(&valid_id?/1),
      do: {:ok, topic},
      else: {:error, :invalid_topic}
  end

  defp ids(%__MODULE__{type: type, host: host}) when type in [:state, :legacy_state], do: [host]
  defp ids(%__MODULE__{group: group, node: node, device: nil}), do: [group, node]
  defp ids(%__MODULE__{group: group, node: node, device: device}), do: [group, node, device]

  defp valid_id?(id), do: id != "" and String.valid?(id) and not String.contains?(id, ["+", "#"])
end

defimpl String.Chars, for: SparkplugB.Topic do
  def to_string(topic), do: SparkplugB.Topic.to_string(topic)
end
