# ACS Sparkplug B
# Tests for the host application state
# Copyright 2026 University of Sheffield

defmodule SparkplugB.HostTest do
  use ExUnit.Case, async: true

  import SparkplugB.Fixtures

  alias SparkplugB.Host
  alias SparkplugB.Metric
  alias SparkplugB.Payload
  alias SparkplugB.Proto.Org.Eclipse.Tahu.Protobuf.Payload, as: Proto
  alias SparkplugB.Topic

  @node %{group: "Site_1", node: "Edge_1", device: nil}
  @device %{@node | device: "Pump 3"}

  defp topic(type, device \\ nil),
    do: %Topic{type: type, group: "Site_1", node: "Edge_1", device: device}

  defp payload(seq, metrics), do: %Payload{seq: seq, metrics: metrics}

  defp birth_metrics(bd_seq \\ 3) do
    [
      %Metric{name: "bdSeq", datatype: :int64, value: bd_seq},
      %Metric{name: "Temperature", alias: 1, datatype: :double, value: 20.5},
      %Metric{name: "Uptime", alias: 2, datatype: :uint64, value: 1, is_transient: true}
    ]
  end

  # A host that has seen the node's birth, and the device's.
  defp born do
    host = Host.new(rebirth_interval: 1_000)
    {host, _events} = Host.handle(host, topic(:nbirth), payload(0, birth_metrics()), 0)
    {host, _events} = Host.handle(host, topic(:dbirth, "Pump 3"), payload(1, birth_metrics()), 0)
    host
  end

  describe "births" do
    test "are reported and remembered" do
      {host, events} = Host.handle(Host.new(), topic(:nbirth), payload(0, birth_metrics()), 0)

      assert events == [{:birth, @node, birth_metrics()}]
      assert Host.birth(host, @node) == birth_metrics()
      assert Host.birth(host, @device) == nil
    end

    test "of a device are accepted before the node's birth is seen" do
      {host, events} =
        Host.handle(Host.new(), topic(:dbirth, "Pump 3"), payload(5, birth_metrics()), 0)

      assert events == [{:birth, @device, birth_metrics()}]
      assert Host.birth(host, @device) == birth_metrics()
    end

    test "of a node end its devices" do
      {host, _events} = Host.handle(born(), topic(:nbirth), payload(0, birth_metrics()), 0)

      assert Host.birth(host, @device) == nil
    end
  end

  describe "data" do
    test "is resolved by alias from the birth" do
      data = payload(2, [%Metric{alias: 1, timestamp: 10, value: {:double_value, 21.0}}])

      assert {_host, [{:data, @device, [metric]}]} =
               Host.handle(born(), topic(:ddata, "Pump 3"), data, 0)

      assert %Metric{name: "Temperature", alias: 1, datatype: :double, value: 21.0, timestamp: 10} =
               metric
    end

    test "is resolved by name when it has no alias" do
      data = payload(2, [%Metric{name: "Temperature", datatype: :double, value: 22.0}])

      assert {_host, [{:data, @device, [%Metric{alias: 1, value: 22.0}]}]} =
               Host.handle(born(), topic(:ddata, "Pump 3"), data, 0)
    end

    test "takes the transient flag from the birth" do
      data = payload(2, [%Metric{alias: 2, value: {:long_value, 5}}])

      assert {_host, [{:data, @device, [%Metric{is_transient: true, value: 5}]}]} =
               Host.handle(born(), topic(:ddata, "Pump 3"), data, 0)
    end

    test "with a metric the birth doesn't have reports it separately" do
      unknown = %Metric{alias: 99, value: {:long_value, 1}}
      data = payload(2, [%Metric{alias: 1, value: {:double_value, 1.0}}, unknown])

      assert {_host,
              [
                {:data, @device, [%Metric{name: "Temperature"}]},
                {:unknown_metric, @device, ^unknown}
              ]} =
               Host.handle(born(), topic(:ddata, "Pump 3"), data, 0)
    end

    test "with only unknown metrics gives no :data event" do
      data = payload(2, [%Metric{alias: 99, value: {:long_value, 1}}])

      assert {_host, [{:unknown_metric, @device, _metric}]} =
               Host.handle(born(), topic(:ddata, "Pump 3"), data, 0)
    end

    test "from a node is resolved from the node's birth" do
      data = payload(2, [%Metric{alias: 1, value: {:double_value, 1.0}}])

      assert {_host, [{:data, @node, [%Metric{name: "Temperature"}]}]} =
               Host.handle(born(), topic(:ndata), data, 0)
    end
  end

  describe "rebirths" do
    test "are asked for when data comes from an unknown device" do
      data = payload(2, [%Metric{alias: 1, value: {:double_value, 1.0}}])

      assert {_host, [{:rebirth, %{device: "Valve 1"}}]} =
               Host.handle(born(), topic(:ddata, "Valve 1"), data, 0)
    end

    test "are asked for again only after the interval" do
      data = payload(nil, [%Metric{alias: 1, value: {:double_value, 1.0}}])
      host = Host.new(rebirth_interval: 1_000)

      {host, [{:rebirth, @device}]} = Host.handle(host, topic(:ddata, "Pump 3"), data, 0)
      {host, []} = Host.handle(host, topic(:ddata, "Pump 3"), data, 999)
      {_host, [{:rebirth, @device}]} = Host.handle(host, topic(:ddata, "Pump 3"), data, 1_000)
    end

    test "can be asked for again straight after a birth" do
      data = payload(nil, [%Metric{alias: 1, value: {:double_value, 1.0}}])
      host = Host.new(rebirth_interval: 1_000)

      {host, [{:rebirth, @device}]} = Host.handle(host, topic(:ddata, "Pump 3"), data, 0)

      {host, _birth} =
        Host.handle(host, topic(:dbirth, "Pump 3"), payload(nil, birth_metrics()), 1)

      {host, [{:death, @device}]} =
        Host.handle(host, topic(:ddeath, "Pump 3"), payload(nil, []), 2)

      {_host, [{:rebirth, @device}]} = Host.handle(host, topic(:ddata, "Pump 3"), data, 3)
    end

    test "for a node are asked for when it has no known birth" do
      data = payload(nil, [%Metric{alias: 1, value: {:double_value, 1.0}}])

      assert {_host, [{:rebirth, @node}]} = Host.handle(Host.new(), topic(:ndata), data, 0)
    end
  end

  describe "deaths" do
    test "of a node end the node and its devices" do
      death = payload(nil, [%Metric{name: "bdSeq", datatype: :int64, value: 3}])

      assert {host, [{:death, @node}]} = Host.handle(born(), topic(:ndeath), death, 0)
      assert Host.birth(host, @node) == nil
      assert Host.birth(host, @device) == nil
    end

    test "of a node from an earlier session are ignored" do
      # The broker sends a node's death when its old connection times out,
      # which can be after the node has connected again and been reborn.
      death = payload(nil, [%Metric{name: "bdSeq", datatype: :int64, value: 2}])

      assert {host, [{:stale_death, @node}]} = Host.handle(born(), topic(:ndeath), death, 0)
      assert Host.birth(host, @device) != nil
    end

    test "of a device leave its node" do
      assert {host, [{:death, @device}]} =
               Host.handle(born(), topic(:ddeath, "Pump 3"), payload(2, []), 0)

      assert Host.birth(host, @device) == nil
      assert Host.birth(host, @node) != nil
    end

    test "of something unknown are ignored" do
      assert {_host, []} = Host.handle(Host.new(), topic(:ndeath), payload(nil, []), 0)
      assert {_host, []} = Host.handle(born(), topic(:ddeath, "Valve 1"), payload(2, []), 0)
    end
  end

  describe "sequence numbers" do
    test "that follow on aren't reported" do
      data = payload(2, [%Metric{alias: 1, value: {:double_value, 1.0}}])

      assert {_host, [{:data, _address, _metrics}]} =
               Host.handle(born(), topic(:ddata, "Pump 3"), data, 0)
    end

    test "that skip are reported, against the node" do
      data = payload(4, [%Metric{alias: 1, value: {:double_value, 1.0}}])

      assert {_host, [{:out_of_sequence, @node, 2, 4}, {:data, @device, _metrics}]} =
               Host.handle(born(), topic(:ddata, "Pump 3"), data, 0)
    end

    test "wrap from 255 to 0" do
      data = fn seq -> payload(seq, [%Metric{alias: 1, value: {:double_value, 1.0}}]) end
      {host, _events} = Host.handle(born(), topic(:ddata, "Pump 3"), data.(2), 0)

      host =
        Enum.reduce(3..255, host, fn seq, host ->
          elem(Host.handle(host, topic(:ndata), data.(seq), 0), 0)
        end)

      assert {_host, [{:data, @device, _metrics}]} =
               Host.handle(host, topic(:ddata, "Pump 3"), data.(0), 0)
    end
  end

  test "commands and host state are ignored" do
    host = born()

    for t <- [topic(:ncmd), topic(:dcmd, "Pump 3"), %Topic{type: :state, host: "historian"}] do
      assert Host.handle(host, t, payload(nil, []), 0) == {host, []}
    end
  end

  test "resolves data without a datatype against a birth Tahu JS encoded" do
    {bin, _js} = load("nbirth")
    {:ok, birth} = SparkplugB.decode(bin, timestamp_unit: :auto)
    {host, _events} = Host.handle(Host.new(), topic(:nbirth), birth, 0)

    # As other Sparkplug sources send DATA: by alias, with no datatype.
    {:ok, iodata, _size} =
      Protox.encode(%Proto{
        seq: 1,
        metrics: [%Proto.Metric{alias: 4, value: {:double_value, 231.0}}]
      })

    {:ok, data} = SparkplugB.decode(IO.iodata_to_binary(iodata))

    assert {_host, [{:data, @node, [metric]}]} = Host.handle(host, topic(:ndata), data, 0)
    assert %Metric{name: "Phases/1/Voltage", datatype: :double, value: 231.0} = metric
  end
end
