# ACS Service Client
# Finds secrets in terms, for tests
# Copyright 2026 University of Sheffield

defmodule FPlus.Test.Secrets do
  @moduledoc false

  # Whether `bytes` appear anywhere in `term`, including inside a larger
  # binary. Searching `inspect/1` output isn't enough: a binary that
  # isn't printable is shown as integers, so a secret inside it is missed.
  def contains?(term, bytes) when is_binary(term), do: :binary.match(term, bytes) != :nomatch
  def contains?(term, bytes) when is_list(term), do: list_contains?(term, bytes)
  def contains?(term, bytes) when is_tuple(term), do: contains?(Tuple.to_list(term), bytes)
  def contains?(term, bytes) when is_map(term), do: contains?(Map.to_list(term), bytes)
  def contains?(_term, _bytes), do: false

  # Handles improper lists too.
  defp list_contains?([head | tail], bytes),
    do: contains?(head, bytes) or list_contains?(tail, bytes)

  defp list_contains?([], _bytes), do: false
  defp list_contains?(tail, bytes), do: contains?(tail, bytes)
end
