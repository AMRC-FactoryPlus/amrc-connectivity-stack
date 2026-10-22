# ACS Ingest
# Tests for the service's supervision tree
# Copyright 2026 University of Sheffield

defmodule IngestTest do
  # The tree registers global names.
  use ExUnit.Case, async: false

  alias Ingest.Config

  @moduletag :capture_log

  @historian Ingest.Parts.SparkplugHistorian
  @uns Ingest.Parts.UnsIngester

  # Nothing answers on port 9, so a client never logs in or connects.
  @fplus [
    directory_url: "http://127.0.0.1:9/",
    principal: "nobody@ACS.INVALID",
    password: "unused",
    kdc: [{"127.0.0.1", 9}]
  ]

  defp config(part_overrides \\ [], overrides \\ []) do
    part =
      struct!(
        Config.Part,
        [
          name: :sparkplug_historian,
          fplus: @fplus,
          stall_timeout: nil,
          connect_timeout: 400,
          writer: %{
            bucket: "bucket",
            batch_size: 5000,
            flush_interval: 1000,
            buffer_limit: 100_000
          }
        ] ++ part_overrides
      )

    struct!(
      Config,
      [
        parts: [part],
        influx_url: "http://127.0.0.1:9",
        influx_org: "org",
        influx_token: "token",
        log_level: :info
      ] ++ overrides
    )
  end

  defp pids(supervisor),
    do: Map.new(Supervisor.which_children(supervisor), fn {id, pid, _, _} -> {id, pid} end)

  defp wait_until(fun, tries \\ 300) do
    cond do
      fun.() -> :ok
      tries == 0 -> flunk("timed out waiting")
      true -> Process.sleep(10) && wait_until(fun, tries - 1)
    end
  end

  test "the writers come first, then a subtree per part" do
    start_supervised!({Ingest, config()})

    assert Enum.map(Supervisor.which_children(Ingest), &elem(&1, 0)) == [
             @historian,
             Ingest.Writers
           ]

    assert Enum.map(Supervisor.which_children(@historian), &elem(&1, 0)) ==
             [Ingest.Sparkplug, FPlus, Ingest.StallMonitor]

    assert Process.whereis(Ingest.Writers.SparkplugHistorian)
    assert Process.whereis(Module.concat(@historian, "FPlus"))
  end

  test "the UNS ingester's part has its own Sparkplug path" do
    uns = %Config.Part{
      name: :uns_ingester,
      fplus: @fplus,
      stall_timeout: nil,
      connect_timeout: 400,
      writer: nil
    }

    # With no historian, there are no writers.
    start_supervised!({Ingest, %{config() | parts: [uns]}})
    assert Enum.map(Supervisor.which_children(Ingest), &elem(&1, 0)) == [@uns]
    refute Process.whereis(Ingest.Writers)

    assert Enum.map(Supervisor.which_children(@uns), &elem(&1, 0)) ==
             [Ingest.Sparkplug, FPlus, Ingest.StallMonitor]

    stop_supervised!(Ingest)

    start_supervised!({Ingest, %{config() | parts: config().parts ++ [uns]}})

    assert Enum.map(Supervisor.which_children(Ingest), &elem(&1, 0)) ==
             [@uns, @historian, Ingest.Writers]

    refute Process.whereis(Module.concat(@historian, "FPlus")) ==
             Process.whereis(Module.concat(@uns, "FPlus"))
  end

  test "a part without health checks has no stall monitor" do
    start_supervised!({Ingest, config(connect_timeout: nil)})
    refute Map.has_key?(pids(@historian), Ingest.StallMonitor)
  end

  test "a part's client that can't connect is restarted in its subtree, and then the service stops" do
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
    writer = %{bucket: "bucket", batch_size: 5000, flush_interval: 60_000, buffer_limit: 100_000}
    config = config([writer: writer], influx_url: Ingest.Test.FakeInflux.url(influx))
    ingest = start_supervised!({Ingest, config}, restart: :temporary)
    ref = Process.monitor(ingest)
    Ingest.Writer.write(Ingest.Writers.SparkplugHistorian, "a value=1i 1\n", 1)
    top = pids(Ingest)
    before = pids(@historian)

    # The connect timeout is 400 ms.
    wait_until(fn ->
      fplus = pids(@historian)[FPlus]
      is_pid(fplus) and fplus != before[FPlus]
    end)

    after_restart = pids(@historian)

    assert after_restart[Ingest.Sparkplug] != before[Ingest.Sparkplug]
    assert after_restart[Ingest.StallMonitor] == before[Ingest.StallMonitor]
    assert pids(Ingest) == top

    # Two restarts, then the third time it gives up: the part stops, so
    # the tree shuts down. The writer stops last, and writes what it held.
    assert_receive {:DOWN, ^ref, :process, ^ingest, :shutdown}, 5000
    assert_received {:written, "a value=1i 1\n"}
  end

  test "a part's restart leaves the other parts as they were" do
    # Two parts with no children of their own: one whose connection
    # check fires, and one with no checks.
    part = fn name, connect_timeout ->
      Supervisor.child_spec(
        {Ingest.Part,
         name: name,
         part: name,
         fplus: @fplus,
         children: [],
         last_message: fn -> nil end,
         stall_timeout: nil,
         connect_timeout: connect_timeout},
        significant: false
      )
    end

    start_supervised!(part.(IngestTest.Failing, 400))
    start_supervised!(part.(IngestTest.Steady, nil))
    failing = pids(IngestTest.Failing)[FPlus]
    steady = pids(IngestTest.Steady)[FPlus]

    wait_until(fn ->
      fplus = pids(IngestTest.Failing)[FPlus]
      is_pid(fplus) and fplus != failing
    end)

    assert pids(IngestTest.Steady)[FPlus] == steady
  end
end
