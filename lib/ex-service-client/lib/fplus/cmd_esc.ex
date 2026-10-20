# ACS Service Client
# Command Escalation
# Copyright 2026 University of Sheffield

defmodule FPlus.CmdEsc do
  @moduledoc """
  Command Escalation, which sends Sparkplug commands on a client's
  behalf, through an `FPlus.HTTP` client.

  An address is a map with `:group`, `:node` and, for a device,
  `:device`, so a `SparkplugB.Topic` works as one.
  """

  alias FPlus.HTTP
  alias FPlus.Service

  @type address :: %{
          required(:group) => String.t(),
          required(:node) => String.t(),
          optional(:device) => String.t() | nil
        }

  @doc """
  Ask for a command: set the metric `name` of `address` to `value`.
  `type` is the Sparkplug type name, such as `"Boolean"`.
  """
  @spec request_cmd(atom(), address(), String.t(), String.t(), term()) :: :ok | {:error, term()}
  def request_cmd(http, address, name, type, value) do
    body = %{name: name, type: type, value: value}

    case HTTP.request(http, Service.command_escalation(), :post, path(address), json: body) do
      {:ok, %{status: 200}} -> :ok
      {:ok, %{status: status}} -> {:error, {:status, status}}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc """
  Ask a node or device to rebirth: to send its birth certificate again.
  """
  @spec rebirth(atom(), address()) :: :ok | {:error, term()}
  def rebirth(http, address) do
    control = if Map.get(address, :device), do: "Device Control", else: "Node Control"
    request_cmd(http, address, "#{control}/Rebirth", "Boolean", true)
  end

  # Device names can contain spaces, so encode each level.
  defp path(%{group: group, node: node} = address) do
    levels = [group, node | List.wrap(Map.get(address, :device))]

    unless Enum.all?(levels, &(is_binary(&1) and &1 != "")) do
      raise ArgumentError, "an address needs a group, a node and optionally a device"
    end

    "v1/address/" <>
      Enum.map_join(levels, "/", fn level -> URI.encode(level, &URI.char_unreserved?/1) end)
  end
end
