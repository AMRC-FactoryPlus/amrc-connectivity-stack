# ACS Service Client
# Library entry point
# Copyright 2026 University of Sheffield

defmodule FPlus do
  @moduledoc """
  A client for Factory+ services, for Elixir services in ACS.

  An application adds the client to its own supervision tree. The client
  keeps the state that has to outlive a single call: Kerberos
  credentials, the MQTT connection, and caches of tokens and service
  URLs. Calls to a service are plain functions that run in the caller's
  process.

  This is the start of the client; see the README for what exists so
  far.
  """
end
