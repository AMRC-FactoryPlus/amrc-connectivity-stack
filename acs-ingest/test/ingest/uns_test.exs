# ACS Ingest
# Tests for the UNS path: routing messages to the workers
# Copyright 2026 University of Sheffield

defmodule Ingest.UnsTest do
  use ExUnit.Case, async: true

  alias Ingest.Uns.Router

  @moduletag :capture_log

  defmodule Consumer do
    @moduledoc false

    # Sends each message to the process in `:pid`, with the worker that
    # handled it. A payload of "crash" crashes the worker.

    @behaviour Ingest.Uns.Consumer

    @impl true
    def handle_message(_topic, "crash", _properties, _received, _opts), do: raise("crash")

    def handle_message(topic, payload, properties, received, opts) do
      send(Keyword.fetch!(opts, :pid), {:message, self(), topic, payload, properties, received})
    end
  end

  setup do
    name = :"uns_#{System.unique_integer([:positive])}"
    test = self()

    start_supervised!(
      {Ingest.Uns,
       name: name,
       subscribe: fn filter ->
         send(test, {:subscribed, filter})
         :ok
       end,
       consumer: {Consumer, pid: test},
       partitions: 4}
    )

    %{router: Ingest.Uns.child(name, "Router"), workers: Ingest.Uns.child(name, "Workers")}
  end

  defp publish(ctx, topic, payload, properties \\ %{}),
    do: send(ctx.router, {:fplus_mqtt, topic, payload, properties})

  defp wait_until(fun, tries \\ 100) do
    cond do
      fun.() -> :ok
      tries == 0 -> flunk("timed out waiting")
      true -> Process.sleep(10) && wait_until(fun, tries - 1)
    end
  end

  test "subscribes to the UNS" do
    assert_receive {:subscribed, "UNS/v1/#"}
  end

  test "hands each message to the consumer, with when it arrived", ctx do
    properties = %{"User-Property": [{"Type", "Double"}]}
    publish(ctx, "UNS/v1/E/S/Edge/D1/V", ~s({"value":1}), properties)

    assert_receive {:message, _worker, "UNS/v1/E/S/Edge/D1/V", ~s({"value":1}), ^properties,
                    received}

    assert_in_delta received, System.os_time(:nanosecond), 5_000_000_000
  end

  test "a topic's messages go to one worker, in order, and topics are spread", ctx do
    topics = for n <- 1..40, do: "UNS/v1/E/S/Edge/D1/M#{n}"

    for n <- 1..5, topic <- topics, do: publish(ctx, topic, Integer.to_string(n))

    workers =
      for topic <- topics do
        [worker | _] =
          pids =
          for n <- 1..5 do
            payload = Integer.to_string(n)
            assert_receive {:message, worker, ^topic, ^payload, _properties, _received}
            worker
          end

        assert Enum.uniq(pids) == [worker]
        worker
      end

    assert length(Enum.uniq(workers)) > 1
  end

  test "notes when it last had a message", ctx do
    assert Router.last_message(ctx.router) == nil
    publish(ctx, "UNS/v1/E/S/Edge/D1/V", "{}")
    assert_receive {:message, _worker, _topic, _payload, _properties, _received}
    assert is_integer(Router.last_message(ctx.router))
  end

  test "a worker that crashes restarts, and the router carries on", ctx do
    topic = "UNS/v1/E/S/Edge/D1/V"
    publish(ctx, topic, "1")
    assert_receive {:message, worker, ^topic, "1", _properties, _received}
    router = Process.whereis(ctx.router)
    ref = Process.monitor(worker)

    publish(ctx, topic, "crash")
    assert_receive {:DOWN, ^ref, :process, ^worker, _reason}

    # A message sent before the worker restarts is lost, as are those
    # waiting for it when it crashed.
    wait_until(fn ->
      pid = GenServer.whereis({:via, PartitionSupervisor, {ctx.workers, topic}})
      pid != worker and Process.alive?(pid)
    end)

    publish(ctx, topic, "2")
    assert_receive {:message, restarted, ^topic, "2", _properties, _received}
    assert restarted != worker
    assert Process.whereis(ctx.router) == router
  end
end
