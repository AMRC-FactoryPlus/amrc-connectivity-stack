# ACS Ingest
# Tests for the Sparkplug path: routing, births, data and rebirths
# Copyright 2026 University of Sheffield

defmodule Ingest.SparkplugTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureLog
  import Ingest.Test.Sparkplug

  alias Ingest.Sparkplug.Metadata
  alias Ingest.Sparkplug.Update

  @moduletag :capture_log

  @d1 %{group: "G1", node: "N1", device: "D1"}
  @t0 1_792_531_570_000

  setup do
    name = :"sparkplug_#{System.unique_integer([:positive])}"
    test = self()

    start_supervised!(
      {Ingest.Sparkplug,
       name: name,
       subscribe: fn filter ->
         send(test, {:subscribed, filter})
         :ok
       end,
       rebirth: fn address ->
         send(test, {:rebirth, address})
         :ok
       end,
       consumers: [{Ingest.Test.Consumer, pid: test}]}
    )

    %{name: name, router: Ingest.Sparkplug.child(name, "Router")}
  end

  defp publish(ctx, topic, payload),
    do: send(ctx.router, {:fplus_mqtt, topic, payload, %{}})

  defp birth(ctx, device \\ "D1", node \\ "N1") do
    metrics = [
      [name: "Schema_UUID", type: :uuid, value: "s-top", alias: 1],
      [name: "Phases/1/Schema_UUID", type: :uuid, value: "s-ph1", alias: 2],
      [name: "Phases/1/Voltage", type: :double, value: 230.5, alias: 3, unit: "V"],
      [name: "Status", type: :string, value: "ok", alias: 4]
    ]

    publish(ctx, "spBv1.0/G1/DBIRTH/#{node}/#{device}", fplus_payload(metrics, timestamp: @t0))
    assert_receive {:update, %Update{kind: :birth, address: %{node: ^node, device: ^device}}}
  end

  defp data(ctx, metrics, device \\ "D1", node \\ "N1"),
    do: publish(ctx, "spBv1.0/G1/DDATA/#{node}/#{device}", payload(metrics, timestamp: @t0))

  test "subscribes to every Sparkplug topic" do
    assert_receive {:subscribed, "spBv1.0/#"}
  end

  test "hands a birth to the consumers, with each metric's metadata", ctx do
    publish(
      ctx,
      "spBv1.0/G1/DBIRTH/N1/D1",
      fplus_payload(
        [
          [name: "Schema_UUID", type: :uuid, value: "s-top", alias: 1],
          [name: "Phases/1/Voltage", type: :double, value: 230.5, alias: 3, unit: "V"]
        ],
        timestamp: @t0
      )
    )

    assert_receive {:update, %Update{kind: :birth, address: @d1} = update}
    assert update.timestamp == @t0 * 1_000_000
    assert_in_delta update.received, System.os_time(:nanosecond), 5_000_000_000

    assert [{%{name: "Schema_UUID"}, schema}, {voltage, meta}] = update.metrics
    assert schema.schema.top == "s-top"
    assert %{name: "Phases/1/Voltage", value: 230.5} = voltage
    assert %Metadata{datatype: :double, unit: "V", schema: %{top: "s-top"}} = meta
  end

  test "resolves DATA by alias", ctx do
    birth(ctx)
    # ACS edge agents send nanoseconds in the millisecond field.
    ns = @t0 * 1_000_000 + 123_456_789
    data(ctx, [[alias: 3, type: :double, value: 229.9, timestamp: ns]])

    assert_receive {:update, %Update{kind: :data, address: @d1, metrics: [{metric, meta}]}}
    assert %{name: "Phases/1/Voltage", alias: 3, value: 229.9, timestamp: ^ns} = metric
    assert %Metadata{name: "Phases/1/Voltage", unit: "V", schema: %{full: ["s-ph1"]}} = meta
  end

  test "resolves names-only DATA by name", ctx do
    metrics = [
      [name: "A", type: :int32, value: 1],
      [name: "B", type: :int32, value: 2]
    ]

    publish(ctx, "spBv1.0/G1/DBIRTH/N1/D1", fplus_payload(metrics))
    assert_receive {:update, %Update{kind: :birth}}

    # The JS historian files both under the last alias-less birth metric.
    data(ctx, [[name: "A", value: 10, type: :int32], [name: "B", value: 20, type: :int32]])
    assert_receive {:update, %Update{kind: :data, metrics: [{a, meta_a}, {b, meta_b}]}}
    assert {a.value, meta_a.name} == {10, "A"}
    assert {b.value, meta_b.name} == {20, "B"}
  end

  test "keeps DATA's own datatype, and fills in a missing one from the birth", ctx do
    birth(ctx)
    data(ctx, [[alias: 3, type: :int32, value: 7], [alias: 3, raw: {:double_value, 1.5}]])

    assert_receive {:update, %Update{kind: :data, metrics: [{own, meta}, {filled, _meta}]}}
    assert {own.datatype, own.value, meta.datatype} == {:int32, 7, :double}
    assert {filled.datatype, filled.value} == {:double, 1.5}
  end

  describe "rebirths" do
    test "asks an unknown device to rebirth once, and drops its data", ctx do
      data(ctx, [[alias: 3, type: :double, value: 1.0]])
      assert_receive {:rebirth, @d1}

      data(ctx, [[alias: 3, type: :double, value: 2.0]])
      refute_receive {:rebirth, _}, 100
      refute_received {:update, _}

      birth(ctx)
      data(ctx, [[alias: 3, type: :double, value: 3.0]])
      assert_receive {:update, %Update{kind: :data, metrics: [{%{value: 3.0}, _meta}]}}
    end

    test "never asks a node", ctx do
      publish(ctx, "spBv1.0/G1/NDATA/N1", payload([[alias: 1, type: :double, value: 1.0]]))
      refute_receive {:rebirth, _}, 100
    end

    test "asks again after a device's death", ctx do
      birth(ctx)
      publish(ctx, "spBv1.0/G1/DDEATH/N1/D1", payload([]))
      data(ctx, [[alias: 3, type: :double, value: 1.0]])
      assert_receive {:rebirth, @d1}
    end

    test "asks again after its node's birth or death", ctx do
      # Each device birth ends the wait between requests.
      for message <- ["NBIRTH", "NDEATH"] do
        birth(ctx)
        publish(ctx, "spBv1.0/G1/#{message}/N1", payload([]))
        data(ctx, [[alias: 3, type: :double, value: 1.0]])
        assert_receive {:rebirth, @d1}
      end
    end
  end

  test "a crash in one node's process leaves the others", ctx do
    birth(ctx, "D1", "N1")
    birth(ctx, "D1", "N2")

    registry = Ingest.Sparkplug.child(ctx.name, "Registry")
    [{n1, _}] = Registry.lookup(registry, {"G1", "N1"})
    [{n2, _}] = Registry.lookup(registry, {"G1", "N2"})
    Process.exit(n1, :kill)

    data(ctx, [[alias: 3, type: :double, value: 1.0]], "D1", "N2")
    assert_receive {:update, %Update{kind: :data, address: %{node: "N2"}}}
    refute_received {:rebirth, _}
    assert [{^n2, _}] = Registry.lookup(registry, {"G1", "N2"})

    # N1's next message starts a new process, which has lost its births.
    # The registry forgets the old one soon after it dies; until then,
    # the router would send to it, and the message would be lost.
    wait_until(fn -> Registry.lookup(registry, {"G1", "N1"}) == [] end)
    data(ctx, [[alias: 3, type: :double, value: 1.0]], "D1", "N1")
    assert_receive {:rebirth, %{node: "N1", device: "D1"}}
    assert [{new_n1, _}] = Registry.lookup(registry, {"G1", "N1"})
    assert new_n1 != n1
  end

  describe "logs and drops" do
    test "a topic that isn't Sparkplug", ctx do
      log =
        capture_log(fn ->
          publish(ctx, "spBv1.0/G1/DDATA//D1", payload([]))
          sync(ctx)
        end)

      assert log =~ ~s(Ignored a message on "spBv1.0/G1/DDATA//D1", which isn't a Sparkplug topic)
    end

    test "a payload that doesn't decode", ctx do
      log =
        capture_log(fn ->
          publish(ctx, "spBv1.0/G1/DDATA/N1/D1", <<0xFF, 0xFF>>)
          sync(ctx, "N1")
        end)

      assert log =~ "Ignored a payload on spBv1.0/G1/DDATA/N1/D1 that doesn't decode"
    end

    test "a DATA metric its birth doesn't have, without asking for a rebirth", ctx do
      birth(ctx)

      log =
        capture_log(fn ->
          data(ctx, [[alias: 99, type: :double, value: 1.0]])
          sync(ctx, "N1")
        end)

      assert log =~ "Ignored a metric from G1/N1/D1 that its birth doesn't have: alias 99"
      refute_received {:rebirth, _}
    end

    test "birth metrics with no name, and their data", ctx do
      metrics = [
        [alias: 1, type: :double, value: 1.0],
        [name: "A", alias: 2, type: :double, value: 2.0]
      ]

      log =
        capture_log(fn ->
          publish(ctx, "spBv1.0/G1/DBIRTH/N1/D1", fplus_payload(metrics))
          assert_receive {:update, %Update{kind: :birth, metrics: [{%{name: "A"}, _meta}]}}
        end)

      assert log =~ "Ignored 1 metrics with no name in the birth of G1/N1/D1"

      data(ctx, [[alias: 1, type: :double, value: 3.0], [alias: 2, type: :double, value: 4.0]])
      assert_receive {:update, %Update{kind: :data, metrics: [{%{name: "A"}, _meta}]}}
    end
  end

  test "the router notes when it last had a message, of any kind", ctx do
    assert Ingest.Sparkplug.Router.last_message(ctx.router) == nil

    before = System.monotonic_time(:millisecond)
    publish(ctx, "spBv1.0/STATE/some-host", ~s({"online": true}))
    last = Ingest.Sparkplug.Router.last_message(ctx.router)
    assert last >= before and last <= System.monotonic_time(:millisecond)
  end

  test "ignores host STATE messages", ctx do
    publish(ctx, "spBv1.0/STATE/some-host", ~s({"online": true}))
    sync(ctx)
    assert Registry.count(Ingest.Sparkplug.child(ctx.name, "Registry")) == 0
  end

  defp wait_until(fun, tries \\ 100) do
    cond do
      fun.() -> :ok
      tries == 0 -> flunk("timed out waiting")
      true -> Process.sleep(10) && wait_until(fun, tries - 1)
    end
  end

  # Wait until the router, and a node's process, have handled what was
  # sent before.
  defp sync(ctx, node \\ nil) do
    :sys.get_state(ctx.router)

    if node do
      [{pid, _}] = Registry.lookup(Ingest.Sparkplug.child(ctx.name, "Registry"), {"G1", node})
      :sys.get_state(pid)
    end

    :ok
  end
end
