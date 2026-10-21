# ACS Ingest
# Tests for the service's supervision tree
# Copyright 2026 University of Sheffield

defmodule IngestTest do
  # The tree registers global names.
  use ExUnit.Case, async: false

  @moduletag :capture_log

  # Nothing answers on port 9, so the client never logs in or connects.
  defp config(overrides) do
    struct!(
      Ingest.Config,
      [
        fplus: [
          directory_url: "http://127.0.0.1:9/",
          principal: "nobody@ACS.INVALID",
          password: "unused",
          kdc: [{"127.0.0.1", 9}]
        ],
        sparkplug_historian: true,
        influx_url: "http://127.0.0.1:9",
        influx_org: "org",
        influx_bucket: "bucket",
        influx_token: "token",
        batch_size: 5000,
        flush_interval: 1000,
        buffer_limit: 100_000,
        stall_timeout: nil,
        connect_timeout: 400,
        log_level: :info
      ] ++ overrides
    )
  end

  defp pids, do: Map.new(Supervisor.which_children(Ingest), fn {id, pid, _, _} -> {id, pid} end)

  defp wait_until(fun, tries \\ 300) do
    cond do
      fun.() -> :ok
      tries == 0 -> flunk("timed out waiting")
      true -> Process.sleep(10) && wait_until(fun, tries - 1)
    end
  end

  test "the parts come after the writers, the stall monitor and the client" do
    start_supervised!({Ingest, config([])})

    assert Enum.map(Supervisor.which_children(Ingest), &elem(&1, 0)) ==
             [Ingest.Sparkplug, FPlus, Ingest.StallMonitor, Ingest.Writers]
  end

  test "without health checks there is no stall monitor" do
    start_supervised!({Ingest, config(connect_timeout: nil)})
    refute Map.has_key?(pids(), Ingest.StallMonitor)
  end

  test "a client that can't connect is restarted with the parts, and then the service stops" do
    test = self()

    influx =
      start_supervised!(
        {Ingest.Test.FakeInflux,
         fn request ->
           send(test, {:written, request.body})
           {204, [], ""}
         end}
      )

    # The writer holds what it's given for a minute.
    config = config(influx_url: Ingest.Test.FakeInflux.url(influx), flush_interval: 60_000)
    ingest = start_supervised!({Ingest, config}, restart: :temporary)
    ref = Process.monitor(ingest)
    Ingest.Writer.write(Ingest.Writers.Sparkplug, "a value=1i 1\n", 1)
    before = pids()

    # CONNECT_TIMEOUT is 400 ms.
    wait_until(fn ->
      fplus = pids()[FPlus]
      is_pid(fplus) and fplus != before[FPlus]
    end)

    after_restart = pids()

    assert after_restart[Ingest.Sparkplug] != before[Ingest.Sparkplug]
    assert after_restart[Ingest.Writers] == before[Ingest.Writers]
    assert after_restart[Ingest.StallMonitor] == before[Ingest.StallMonitor]

    # Two restarts, then the third time it gives up, and the tree shuts
    # down. The writer stops last, and writes what it held.
    assert_receive {:DOWN, ^ref, :process, ^ingest, :shutdown}, 5000
    assert_received {:written, "a value=1i 1\n"}
  end
end
