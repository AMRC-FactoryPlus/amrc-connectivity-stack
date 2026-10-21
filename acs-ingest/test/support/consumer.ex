# ACS Ingest
# A Sparkplug consumer for tests
# Copyright 2026 University of Sheffield

defmodule Ingest.Test.Consumer do
  @moduledoc false

  # Sends each update to the process in `:pid`.

  @behaviour Ingest.Sparkplug.Consumer

  @impl true
  def handle_update(update, opts), do: send(Keyword.fetch!(opts, :pid), {:update, update})
end
