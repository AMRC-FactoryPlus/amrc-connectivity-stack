# ACS Ingest
# A consumer of resolved Sparkplug metrics
# Copyright 2026 University of Sheffield

defmodule Ingest.Sparkplug.Consumer do
  @moduledoc """
  A consumer of resolved Sparkplug metrics, such as the Sparkplug
  historian. It is given to `Ingest.Sparkplug` as a `{module, opts}`
  pair.

  Each edge node's process calls `c:handle_update/2` with every
  `Ingest.Sparkplug.Update`, in its own process, so the consumers' work
  is spread across the nodes. A call should not block for long, as the
  node's next messages wait for it. If it raises, the node's process
  crashes and loses the node's births, which a rebirth then restores.
  """

  @callback handle_update(Ingest.Sparkplug.Update.t(), opts :: keyword()) :: any()
end
