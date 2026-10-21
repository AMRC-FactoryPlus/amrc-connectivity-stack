# ACS Ingest
# Tests for restarting the Factory+ client when data or the connection stops
# Copyright 2026 University of Sheffield

defmodule Ingest.StallMonitorTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureLog

  alias Ingest.StallMonitor

  @moduletag :capture_log

  # The checks run when the test says, on a clock the test moves: the
  # monitor's own checks are an hour apart.
  defp start(opts \\ []) do
    test = self()

    world =
      start_supervised!({Agent, fn -> %{now: 0, last: nil, connected: true} end}, id: make_ref())

    defaults = [
      name: :"monitor_#{System.unique_integer([:positive])}",
      stall_timeout: 2000,
      connect_timeout: 1000,
      last_message: fn -> Agent.get(world, & &1.last) end,
      connected?: fn -> Agent.get(world, & &1.connected) end,
      restart: fn -> send(test, :restarted) end,
      check_interval: 3_600_000,
      clock: fn -> Agent.get(world, & &1.now) end
    ]

    # It is significant in Ingest, which the test supervisor isn't.
    opts = Keyword.merge(defaults, opts)
    spec = Supervisor.child_spec({StallMonitor, opts}, id: opts[:name], significant: false)
    pid = start_supervised!(spec)
    %{pid: pid, world: world}
  end

  defp at(ctx, now), do: Agent.update(ctx.world, &%{&1 | now: now})
  defp message(ctx), do: Agent.update(ctx.world, &%{&1 | last: &1.now})
  defp connected(ctx, up), do: Agent.update(ctx.world, &%{&1 | connected: up})

  # Check at a time, and wait until the monitor has.
  defp check(ctx, now) do
    at(ctx, now)
    send(ctx.pid, :check)
    :sys.get_state(ctx.pid)
  end

  describe "the stall check" do
    test "waits for the first message" do
      ctx = start()
      check(ctx, 3_600_000)
      refute_received :restarted
    end

    test "restarts the client when messages stop" do
      ctx = start()
      message(ctx)
      check(ctx, 1999)
      refute_received :restarted

      log = capture_log(fn -> check(ctx, 2000) end)
      assert_received :restarted

      assert log =~
               "No message for 2 s (STALL_TIMEOUT 2 s); restarting the Factory+ client (1 of 2)"
    end

    test "doesn't fire while messages arrive" do
      ctx = start()

      for now <- 0..20_000//1500 do
        at(ctx, now)
        message(ctx)
        check(ctx, now)
      end

      refute_received :restarted
    end

    test "counts from the restart, and fires again if no message comes" do
      ctx = start()
      message(ctx)
      check(ctx, 2000)
      assert_received :restarted

      # The last message was 3.9 s ago, but the restart 1.9 s.
      check(ctx, 3999)
      refute_received :restarted

      log = capture_log(fn -> check(ctx, 4000) end)
      assert_received :restarted
      assert log =~ "restarting the Factory+ client (2 of 2)"
    end

    test "stops the service when restarting doesn't help" do
      ctx = start()
      ref = Process.monitor(ctx.pid)
      message(ctx)
      check(ctx, 2000)
      check(ctx, 4000)

      log =
        capture_log(fn ->
          at(ctx, 6000)
          send(ctx.pid, :check)
          assert_receive {:DOWN, ^ref, :process, _pid, {:shutdown, :stalled}}
        end)

      assert log =~
               "No message for 2 s (STALL_TIMEOUT 2 s). Restarting the Factory+ client 2 times " <>
                 "hasn't helped, so the service is stopping"

      assert_received :restarted
      assert_received :restarted
      refute_received :restarted
    end

    test "starts counting again after a message" do
      ctx = start()
      message(ctx)
      check(ctx, 2000)
      at(ctx, 3000)
      message(ctx)
      check(ctx, 3000)

      log = capture_log(fn -> check(ctx, 5000) end)
      assert log =~ "(1 of 2)"
    end

    test "logs when it is armed" do
      ctx = start()
      message(ctx)
      log = capture_log(fn -> check(ctx, 10) end)
      assert log =~ "Stall check armed by the first message"
    end
  end

  describe "the connection check" do
    test "restarts the client when it hasn't connected since the start" do
      ctx = start(stall_timeout: nil)
      connected(ctx, false)
      check(ctx, 999)
      refute_received :restarted

      log = capture_log(fn -> check(ctx, 1000) end)
      assert_received :restarted

      assert log =~
               "The MQTT connection hasn't been up with its subscriptions granted for 1 s " <>
                 "(CONNECT_TIMEOUT 1 s); restarting the Factory+ client (1 of 2)"
    end

    test "counts from when the connection was lost" do
      ctx = start(stall_timeout: nil)
      check(ctx, 5000)
      connected(ctx, false)

      log = capture_log(fn -> check(ctx, 6000) end)
      assert log =~ "MQTT connection lost, or a subscription with it"
      refute_received :restarted

      check(ctx, 6999)
      refute_received :restarted
      check(ctx, 7000)
      assert_received :restarted
    end

    test "doesn't fire while connected, however quiet" do
      ctx = start(stall_timeout: nil)
      check(ctx, 3_600_000)
      refute_received :restarted
    end

    test "stops the service when restarting doesn't help, unless it reconnects" do
      ctx = start(stall_timeout: nil)
      ref = Process.monitor(ctx.pid)
      connected(ctx, false)
      check(ctx, 1000)
      check(ctx, 2000)

      # A working connection starts the count again.
      connected(ctx, true)
      check(ctx, 2500)
      connected(ctx, false)
      check(ctx, 2600)
      log = capture_log(fn -> check(ctx, 3600) end)
      assert log =~ "(1 of 2)"

      check(ctx, 4600)
      at(ctx, 5600)
      send(ctx.pid, :check)
      assert_receive {:DOWN, ^ref, :process, _pid, {:shutdown, :disconnected}}
    end
  end

  test "a client restarted for a stall must reconnect within the connection timeout" do
    ctx = start()
    message(ctx)
    check(ctx, 2000)
    assert_received :restarted

    # Connected when it stalled, and not since the restart.
    connected(ctx, false)
    check(ctx, 2999)
    refute_received :restarted

    log = capture_log(fn -> check(ctx, 3000) end)
    assert_received :restarted
    assert log =~ "hasn't been up with its subscriptions granted for 1 s"
  end

  test "checks that are off never fire" do
    ctx = start(stall_timeout: nil, connect_timeout: nil)
    connected(ctx, false)
    message(ctx)
    check(ctx, 3_600_000)
    refute_received :restarted
  end

  test "a function that exits counts as no message, or no connection" do
    ctx =
      start(
        stall_timeout: nil,
        last_message: fn -> exit(:noproc) end,
        connected?: fn -> exit(:noproc) end
      )

    check(ctx, 1000)
    assert_received :restarted
  end

  test "a restart that exits is logged" do
    ctx = start(stall_timeout: nil, restart: fn -> exit(:noproc) end)
    connected(ctx, false)
    log = capture_log(fn -> check(ctx, 1000) end)
    assert log =~ "Restarting the Factory+ client failed: :noproc"
    assert Process.alive?(ctx.pid)
  end

  test "checks a quarter of the shorter timeout apart, from 100 ms to 30 s" do
    interval = fn opts ->
      opts = Keyword.merge([stall_timeout: nil, connect_timeout: nil, check_interval: nil], opts)
      :sys.get_state(start(opts).pid).interval
    end

    assert interval.(stall_timeout: 600_000, connect_timeout: 300_000) == 30_000
    assert interval.(stall_timeout: 20_000) == 5000
    assert interval.(connect_timeout: 200) == 100
    assert interval.([]) == nil
  end
end
