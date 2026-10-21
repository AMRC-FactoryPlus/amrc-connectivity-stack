# ACS Ingest
# The Sparkplug path
# Copyright 2026 University of Sheffield

defmodule Ingest.Sparkplug do
  @moduledoc """
  The Sparkplug path: the processes that read `spBv1.0/#` through the
  Factory+ client. It runs when the Sparkplug historian is on.

  It has no children yet.

  ## Options

    * `:fplus` - required. The name of the `FPlus` client.
    * `:writer` - required. The `Ingest.Writer` for the historian's
      points.
  """

  use Supervisor

  @doc "Start the Sparkplug path's supervisor."
  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(opts) do
    _opts = Keyword.validate!(opts, [:fplus, :writer])
    Supervisor.init([], strategy: :one_for_one)
  end
end
