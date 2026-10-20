# ACS Sparkplug B
# Library entry point
# Copyright 2026 University of Sheffield

defmodule SparkplugB do
  @moduledoc """
  Sparkplug B for Elixir.

  `decode/2` turns a Sparkplug B payload into a `SparkplugB.Payload` of
  `SparkplugB.Metric` structs with native Elixir values.

  The protobuf modules under `SparkplugB.Proto` are generated from the
  Eclipse Tahu `sparkplug_b.proto` and must not be edited by hand. See
  the README for how to regenerate them.
  """

  alias SparkplugB.DecodeError
  alias SparkplugB.Payload
  alias SparkplugB.Proto.Org.Eclipse.Tahu.Protobuf.Payload, as: Proto

  @units [:ms, :auto]

  @doc """
  Decode a Sparkplug B payload.

  Decoded timestamps are always integer nanoseconds since the Unix epoch,
  whatever unit they had on the wire.

  ## Options

    * `:timestamp_unit` - how to read timestamps on the wire. `:ms`, the
      default, follows the spec. `:auto` reads values below 10^15 as
      milliseconds and the rest as nanoseconds. ACS edge agents send
      nanoseconds, so ACS consumers pass `:auto`.

  Returns `{:error, %SparkplugB.DecodeError{}}` if the binary isn't a
  valid payload.
  """
  @spec decode(binary(), keyword()) :: {:ok, Payload.t()} | {:error, DecodeError.t()}
  def decode(binary, opts \\ []) when is_binary(binary) do
    opts = Keyword.validate!(opts, timestamp_unit: :ms)
    unit = opts[:timestamp_unit]

    unless unit in @units do
      raise ArgumentError,
            "timestamp_unit must be one of #{inspect(@units)}, got: #{inspect(unit)}"
    end

    case Protox.decode(binary, Proto) do
      {:ok, proto} -> {:ok, Payload.from_proto(proto, unit)}
      {:error, error} -> {:error, %DecodeError{message: message(error)}}
    end
  end

  defp message(error) when is_exception(error), do: Exception.message(error)
  defp message(error), do: inspect(error)
end
