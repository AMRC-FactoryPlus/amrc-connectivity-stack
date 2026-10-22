# ACS Ingest
# The simulated-data markers on a Sparkplug metric
# Copyright 2026 University of Sheffield

defmodule Ingest.Sparkplug.Simulated do
  @moduledoc """
  The simulated-data markers on a metric: its `simulated` and `run_id`
  properties, which edge simulators set so that their data can be told
  from real data. The historian writes them as tags, and the UNS
  ingester as user properties.

  As in the JS services, a metric is simulated when its own `simulated`
  property is truthy as JS sees it (so the string `"no"` counts), and
  then has a run ID when its `run_id` property is truthy too. A truthy
  run ID that isn't a string or an integer is an error.
  """

  alias Ingest.JS
  alias SparkplugB.Property

  @doc "A metric's markers, from its properties."
  @spec marker(%{String.t() => Property.t()} | nil) ::
          {:ok, :real | {:simulated, String.t() | nil}} | {:error, String.t()}
  def marker(%{"simulated" => %Property{value: flag}} = properties) do
    if JS.truthy?(flag), do: run_id(properties["run_id"]), else: {:ok, :real}
  end

  def marker(_properties), do: {:ok, :real}

  defp run_id(%Property{value: run}) when is_binary(run) or is_integer(run) do
    if JS.truthy?(run),
      do: {:ok, {:simulated, to_string(run)}},
      else: {:ok, {:simulated, nil}}
  end

  defp run_id(%Property{value: run}) do
    if JS.truthy?(run),
      do: {:error, "its run_id, #{inspect(run)}, isn't a string or an integer"},
      else: {:ok, {:simulated, nil}}
  end

  defp run_id(nil), do: {:ok, {:simulated, nil}}
end
