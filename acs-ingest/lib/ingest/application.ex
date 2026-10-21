# ACS Ingest
# The OTP application
# Copyright 2026 University of Sheffield

defmodule Ingest.Application do
  @moduledoc false

  use Application

  require Logger

  @impl true
  def start(_type, _args) do
    case Ingest.Config.from_env() do
      {:ok, config} ->
        Ingest.start_link(config)

      {:error, reason} ->
        Logger.error("Not starting: #{reason}")
        {:error, {:config, reason}}
    end
  end
end
