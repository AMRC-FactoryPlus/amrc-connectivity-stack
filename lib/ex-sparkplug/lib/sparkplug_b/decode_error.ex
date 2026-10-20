# ACS Sparkplug B
# Error for payloads that don't decode
# Copyright 2026 University of Sheffield

defmodule SparkplugB.DecodeError do
  @moduledoc """
  The reason `SparkplugB.decode/2` gives for a binary that isn't a valid
  Sparkplug B payload.
  """

  defexception [:message]

  @type t :: %__MODULE__{message: String.t()}
end
