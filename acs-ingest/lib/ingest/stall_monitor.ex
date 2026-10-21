# ACS Ingest
# Restarts the Factory+ client when data or the connection stops
# Copyright 2026 University of Sheffield

defmodule Ingest.StallMonitor do
  @moduledoc """
  Restarts the Factory+ client when messages stop arriving, or when its
  MQTT connection stays down, and stops the service when restarting
  doesn't help. It replaces the JS services' watchdogs
  (`lib/watchdog.ts`), which exit the process the first time.

  It has the JS's two checks:

    * **Stall** (`:stall_timeout`): no message for this long, once one
      has arrived. Any message counts, as it shows the connection and
      the subscription work. Before the first, the check can't fire, as
      a site with no traffic isn't a fault.
    * **Connection** (`:connect_timeout`): the client hasn't been
      connected with its subscriptions granted for this long, counting
      from the start or from when it lost them. This covers a client
      that never gets a first message.

  When one fires, it calls `:restart`. In `Ingest` that restarts the
  `FPlus` client, with fresh credentials and a fresh connection, and
  the parts after it, which subscribe again. The writers keep their
  buffers. Both checks then count from the restart, and the stall check
  stays armed, so data that doesn't come back fires it again.

  If a check fires `:max_restarts` times in a row without recovering
  in between (a message for the stall check, a working connection for
  the connection check), the next time it stops with
  `{:shutdown, :stalled}` or `{:shutdown, :disconnected}`. It is a
  significant child of `Ingest`, so `Ingest` shuts down, the writers
  writing what they hold, and the application stops. In a release that
  stops the VM, and Kubernetes restarts the pod, as it did when the JS
  services exited.

  ## Options

    * `:name` - required.
    * `:stall_timeout`, `:connect_timeout` - in ms, or `nil` to turn
      the check off.
    * `:last_message` - required. A function returning when the last
      message arrived, as `System.monotonic_time(:millisecond)`, or
      `nil` if none has.
    * `:connected?` - required. A function returning whether the client
      is connected with its subscriptions granted.
    * `:restart` - required. A function that restarts the client.
    * `:max_restarts` - default 2.
    * `:check_interval` - in ms. Default a quarter of the shorter
      timeout, from 100 ms to 30 s.
    * `:clock` - a function returning the time in ms, for tests.
      Default `System.monotonic_time(:millisecond)`.

  The functions may exit, for example while the process they call is
  restarting: `:last_message` then counts as no message, and
  `:connected?` as not connected.
  """

  use GenServer, restart: :transient, significant: true

  require Logger

  @doc "Start the monitor."
  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    opts =
      Keyword.validate!(
        opts,
        [
          :name,
          :stall_timeout,
          :connect_timeout,
          :last_message,
          :connected?,
          :restart,
          :check_interval,
          max_restarts: 2,
          clock: fn -> System.monotonic_time(:millisecond) end
        ]
      )

    GenServer.start_link(__MODULE__, opts, name: Keyword.fetch!(opts, :name))
  end

  @impl true
  def init(opts) do
    clock = Keyword.fetch!(opts, :clock)
    now = clock.()

    state = %{
      stall_timeout: opts[:stall_timeout],
      connect_timeout: opts[:connect_timeout],
      last_message: Keyword.fetch!(opts, :last_message),
      connected?: Keyword.fetch!(opts, :connected?),
      restart: Keyword.fetch!(opts, :restart),
      max_restarts: Keyword.fetch!(opts, :max_restarts),
      clock: clock,
      interval: opts[:check_interval] || interval(opts[:stall_timeout], opts[:connect_timeout]),
      # The last message seen, and when the client was last restarted
      # (or the monitor started).
      seen: nil,
      restarted_at: now,
      # Whether the connection was up at the last check, and if not,
      # since when it hasn't been.
      connected: false,
      down_since: now,
      # Times each check has fired in a row.
      stalled: 0,
      disconnected: 0
    }

    log_checks(state)
    {:ok, schedule(state)}
  end

  @impl true
  def handle_info(:check, state) do
    now = state.clock.()
    state = state |> see_messages() |> see_connection(now)

    cond do
      stalled?(state, now) -> fire(state, :stalled, now)
      disconnected?(state, now) -> fire(state, :disconnected, now)
      true -> {:noreply, schedule(state)}
    end
  end

  defp see_messages(state) do
    case call(state.last_message, nil) do
      nil ->
        state

      last when last == state.seen ->
        state

      last ->
        if state.seen == nil and state.stall_timeout do
          Logger.info(
            "Stall check armed by the first message: the Factory+ client restarts " <>
              "if none arrives for #{seconds(state.stall_timeout)}"
          )
        end

        %{state | seen: last, stalled: 0}
    end
  end

  defp see_connection(state, now) do
    case {state.connected, call(state.connected?, false)} do
      {true, true} ->
        state

      {false, true} ->
        Logger.info("MQTT connected with its subscriptions granted")
        %{state | connected: true, down_since: nil, disconnected: 0}

      {true, false} ->
        log_down(state)
        %{state | connected: false, down_since: now}

      {false, false} ->
        state
    end
  end

  defp log_down(%{connect_timeout: nil}),
    do: Logger.warning("MQTT connection lost, or a subscription with it")

  defp log_down(state) do
    Logger.warning(
      "MQTT connection lost, or a subscription with it; restarting the Factory+ client " <>
        "in #{seconds(state.connect_timeout)} unless it's back"
    )
  end

  defp stalled?(%{stall_timeout: timeout, seen: seen} = state, now)
       when timeout != nil and seen != nil,
       do: quiet(state, now) >= timeout

  defp stalled?(_state, _now), do: false

  defp disconnected?(%{connect_timeout: timeout, down_since: since}, now)
       when timeout != nil and since != nil,
       do: now - since >= timeout

  defp disconnected?(_state, _now), do: false

  # How long since a message or a restart, whichever was later.
  defp quiet(state, now), do: now - max(state.seen, state.restarted_at)

  defp fire(state, check, now) do
    count = Map.fetch!(state, check) + 1
    why = why(state, check, now)

    if count > state.max_restarts do
      Logger.error(
        "#{why}. Restarting the Factory+ client #{state.max_restarts} times hasn't helped, " <>
          "so the service is stopping"
      )

      {:stop, {:shutdown, check}, state}
    else
      Logger.error("#{why}; restarting the Factory+ client (#{count} of #{state.max_restarts})")

      restart(state)
      after_restart = state.clock.()

      {:noreply,
       schedule(%{
         Map.put(state, check, count)
         | restarted_at: after_restart,
           connected: false,
           down_since: after_restart
       })}
    end
  end

  defp why(state, :stalled, now) do
    "No message for #{seconds(quiet(state, now))} " <>
      "(STALL_TIMEOUT #{seconds(state.stall_timeout)})"
  end

  defp why(state, :disconnected, now) do
    "The MQTT connection hasn't been up with its subscriptions granted " <>
      "for #{seconds(now - state.down_since)} (CONNECT_TIMEOUT #{seconds(state.connect_timeout)})"
  end

  defp restart(state) do
    state.restart.()
  catch
    :exit, reason -> Logger.error("Restarting the Factory+ client failed: #{inspect(reason)}")
  end

  defp call(fun, default) do
    fun.()
  catch
    :exit, _reason -> default
  end

  defp interval(nil, nil), do: nil

  defp interval(stall, connect) do
    shorter = [stall, connect] |> Enum.reject(&is_nil/1) |> Enum.min()
    shorter |> div(4) |> max(100) |> min(30_000)
  end

  defp schedule(%{interval: nil} = state), do: state

  defp schedule(state) do
    Process.send_after(self(), :check, state.interval)
    state
  end

  defp log_checks(state) do
    if state.stall_timeout do
      Logger.info(
        "Stall check: the Factory+ client restarts if no message arrives " <>
          "for #{seconds(state.stall_timeout)}, once one has"
      )
    else
      Logger.warning("Stall check off (STALL_TIMEOUT=0)")
    end

    if state.connect_timeout do
      Logger.info(
        "Connection check: the Factory+ client restarts if it isn't connected with " <>
          "its subscriptions granted for #{seconds(state.connect_timeout)}"
      )
    else
      Logger.warning("Connection check off (CONNECT_TIMEOUT=0)")
    end
  end

  defp seconds(ms), do: "#{div(ms + 500, 1000)} s"
end
