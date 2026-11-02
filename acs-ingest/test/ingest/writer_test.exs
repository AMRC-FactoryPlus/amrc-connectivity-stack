# ACS Ingest
# Tests for buffered writes to InfluxDB, against a fake InfluxDB
# Copyright 2026 University of Sheffield

defmodule Ingest.WriterTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureLog

  alias Ingest.Test.FakeInflux
  alias Ingest.Writer

  setup do
    n = System.unique_integer([:positive])
    finch = :"finch_#{n}"
    start_supervised!({Finch, name: finch})
    %{finch: finch, name: :"writer_#{n}"}
  end

  # A fake InfluxDB that sends each request to the test as
  # `{:request, conn, request}` and answers with the next of `responses`,
  # then with 204s. A response of `{:block, response}` waits for
  # `:release` sent to `conn` first; `:block` then answers 204.
  defp influx(responses \\ []) do
    test = self()
    responses = start_supervised!({Agent, fn -> responses end})

    handler = fn request ->
      send(test, {:request, self(), request})

      case Agent.get_and_update(responses, &next_response/1) do
        :block ->
          receive do
            :release -> {204, [], ""}
          end

        {:block, response} ->
          receive do
            :release -> response
          end

        response ->
          response
      end
    end

    start_supervised!({FakeInflux, handler}) |> FakeInflux.url()
  end

  defp next_response([response | rest]), do: {response, rest}
  defp next_response([]), do: {{204, [], ""}, []}

  defp start_writer(ctx, url, opts \\ []) do
    defaults = [
      name: ctx.name,
      finch: ctx.finch,
      url: url,
      org: "test-org",
      bucket: "test-bucket",
      token: "test-token",
      batch_size: 100,
      flush_interval: 60_000,
      min_backoff: 10,
      max_backoff: 2000
    ]

    start_supervised!({Writer, Keyword.merge(defaults, opts)})
    ctx.name
  end

  defp lines(names), do: Enum.map_join(names, &"#{&1} value=1i 1\n")

  # The body of the next request.
  defp body do
    assert_receive {:request, _conn, %{body: body}}, 2000
    body
  end

  defp wait_until(fun, tries \\ 100) do
    cond do
      fun.() -> :ok
      tries == 0 -> flunk("timed out waiting")
      true -> Process.sleep(10) && wait_until(fun, tries - 1)
    end
  end

  describe "flushing" do
    test "writes once the buffer holds a batch", ctx do
      writer = start_writer(ctx, influx(), batch_size: 3)

      Writer.write(writer, lines(["a"]), 1)
      Writer.write(writer, [lines(["b"]), lines(["c"])], 2)

      assert_receive {:request, _conn, request}
      assert request.method == :POST
      assert request.path == "/api/v2/write"

      assert request.query == %{
               "org" => "test-org",
               "bucket" => "test-bucket",
               "precision" => "ns"
             }

      assert request.headers["authorization"] == "Token test-token"
      assert request.headers["content-type"] == "text/plain; charset=utf-8"
      assert request.body == lines(["a", "b", "c"])

      wait_until(fn -> Writer.stats(writer).written == 3 end)
    end

    test "makes batches of whole writes, up to the batch size", ctx do
      writer = start_writer(ctx, influx(), batch_size: 3)

      Writer.write(writer, lines(["a", "b"]), 2)
      Writer.write(writer, lines(["c", "d"]), 2)
      assert body() == lines(["a", "b"])
      refute_receive {:request, _conn, _request}, 100

      Writer.write(writer, lines(["e"]), 1)
      assert body() == lines(["c", "d", "e"])

      # One write bigger than a batch goes on its own.
      Writer.write(writer, lines(["f", "g", "h", "i"]), 4)
      assert body() == lines(["f", "g", "h", "i"])
    end

    test "writes what it holds after the flush interval", ctx do
      writer = start_writer(ctx, influx(), flush_interval: 100)

      started = System.monotonic_time(:millisecond)
      Writer.write(writer, lines(["a"]), 1)
      Writer.write(writer, lines(["b"]), 1)

      assert body() == lines(["a", "b"])
      assert System.monotonic_time(:millisecond) - started >= 90

      Writer.write(writer, lines(["c"]), 1)
      assert body() == lines(["c"])
    end

    test "builds the URL from one with a path", ctx do
      writer = start_writer(ctx, influx() <> "/influx/", batch_size: 1)

      Writer.write(writer, lines(["a"]), 1)
      assert_receive {:request, _conn, %{path: "/influx/api/v2/write"}}
    end
  end

  test "keeps buffering while a write is slow, with one write in flight", ctx do
    writer = start_writer(ctx, influx([:block]), batch_size: 1)

    Writer.write(writer, lines(["a"]), 1)
    assert_receive {:request, conn, %{body: "a value=1i 1\n"}}

    Writer.write(writer, lines(["b"]), 1)
    Writer.write(writer, lines(["c"]), 1)

    {time, stats} = :timer.tc(fn -> Writer.stats(writer) end)
    assert time < 50_000
    assert %{buffered: 2, writing: 1, written: 0} = stats
    refute_receive {:request, _conn, _request}, 100

    send(conn, :release)
    assert body() == lines(["b"])
    assert body() == lines(["c"])
    wait_until(fn -> Writer.stats(writer).written == 3 end)
  end

  describe "failures" do
    @describetag :capture_log

    test "retries after a 5xx", ctx do
      writer = start_writer(ctx, influx([{500, [], "oops"}]), batch_size: 1)

      log =
        capture_log(fn ->
          Writer.write(writer, lines(["a"]), 1)
          assert body() == lines(["a"])
          assert body() == lines(["a"])
          wait_until(fn -> Writer.stats(writer).written == 1 end)
        end)

      assert log =~ "Writing 1 point to InfluxDB bucket test-bucket failed: InfluxDB answered 500"
      assert log =~ "Writing to InfluxDB bucket test-bucket again"
    end

    test "waits as long as a 429's Retry-After says", ctx do
      writer = start_writer(ctx, influx([{429, [{"retry-after", "1"}], ""}]), batch_size: 1)

      Writer.write(writer, lines(["a"]), 1)
      assert body() == lines(["a"])
      failed = System.monotonic_time(:millisecond)

      assert body() == lines(["a"])
      assert System.monotonic_time(:millisecond) - failed >= 950
    end

    test "backs off longer after each failure, and starts no other writes", ctx do
      url = influx([{503, [], ""}, {503, [], ""}, {503, [], ""}])
      writer = start_writer(ctx, url, batch_size: 1, min_backoff: 50)

      Writer.write(writer, lines(["a"]), 1)
      Writer.write(writer, lines(["b"]), 1)

      times =
        for _ <- 1..4 do
          assert body() == lines(["a"])
          System.monotonic_time(:millisecond)
        end

      gaps = times |> Enum.chunk_every(2, 1, :discard) |> Enum.map(fn [a, b] -> b - a end)
      assert [first, second, third] = gaps
      assert first >= 45 and second >= 95 and third >= 195

      assert body() == lines(["b"])
    end

    test "retries a network error", ctx do
      writer = start_writer(ctx, influx([:close]), batch_size: 1)

      Writer.write(writer, lines(["a"]), 1)
      assert body() == lines(["a"])
      assert body() == lines(["a"])
      wait_until(fn -> Writer.stats(writer).written == 1 end)
    end

    test "retries when the token, org or bucket is wrong", ctx do
      url = influx([{401, [], ""}, {403, [], ""}, {404, [], ""}])
      writer = start_writer(ctx, url, batch_size: 1)

      Writer.write(writer, lines(["a"]), 1)
      for _ <- 1..4, do: assert(body() == lines(["a"]))
      wait_until(fn -> Writer.stats(writer).written == 1 end)
    end

    test "drops a batch InfluxDB rejects", ctx do
      rejection = ~s({"code":"invalid","message":"unable to parse 'bad'"})
      writer = start_writer(ctx, influx([{400, [], rejection}]), batch_size: 1)

      log =
        capture_log(fn ->
          Writer.write(writer, "bad\n", 1)
          assert body() == "bad\n"

          Writer.write(writer, lines(["a"]), 1)
          assert body() == lines(["a"])
          wait_until(fn -> Writer.stats(writer).written == 1 end)
        end)

      assert %{rejected: 1, buffered: 0} = Writer.stats(writer)

      assert log =~
               "Dropped 1 point for InfluxDB bucket test-bucket: InfluxDB answered 400: #{rejection}"
    end
  end

  test "drops the oldest points when the buffer is over its limit", ctx do
    writer = start_writer(ctx, influx([:block]), batch_size: 1, buffer_limit: 3)

    Writer.write(writer, lines(["a"]), 1)
    assert_receive {:request, conn, %{body: "a value=1i 1\n"}}

    log =
      capture_log(fn ->
        for name <- ["b", "c", "d", "e", "f"], do: Writer.write(writer, lines([name]), 1)
        assert %{buffered: 3, dropped: 2} = Writer.stats(writer)
      end)

    # Logged once, at the first drop.
    assert log =~
             "The buffer for InfluxDB bucket test-bucket is over 3 points: " <>
               "dropped the oldest 1 point, 1 since starting"

    refute log =~ "2 since starting"

    send(conn, :release)
    assert body() == lines(["d"])
    assert body() == lines(["e"])
    assert body() == lines(["f"])
  end

  describe "stopping" do
    test "writes what it holds", ctx do
      writer = start_writer(ctx, influx())

      Writer.write(writer, lines(["a"]), 1)
      Writer.write(writer, lines(["b"]), 1)
      refute_receive {:request, _conn, _request}, 50

      stop_supervised!(writer)
      assert_received {:request, _conn, %{body: "a value=1i 1\nb value=1i 1\n"}}
    end

    test "waits for a write in flight first, and writes it again if it fails", ctx do
      writer = start_writer(ctx, influx([{:block, {500, [], ""}}]), batch_size: 1)

      Writer.write(writer, lines(["a"]), 1)
      assert_receive {:request, conn, %{body: "a value=1i 1\n"}}
      Writer.write(writer, lines(["b"]), 1)

      Process.send_after(conn, :release, 100)
      stop_supervised!(writer)
      assert body() == lines(["a"])
      assert body() == lines(["b"])
    end

    @tag :capture_log
    test "logs what it couldn't write", ctx do
      url = influx(List.duplicate({500, [], ""}, 3))
      writer = start_writer(ctx, url, min_backoff: 60_000)

      Writer.write(writer, lines(["a", "b"]), 2)
      Writer.write(writer, lines(["c"]), 1)

      log = capture_log(fn -> stop_supervised!(writer) end)

      assert log =~
               "Lost 3 points for InfluxDB bucket test-bucket when stopping: InfluxDB answered 500"
    end
  end

  test "keeps the token and the buffer out of its status", ctx do
    writer = start_writer(ctx, influx())
    Writer.write(writer, lines(["secret-line"]), 1)

    status = inspect(:sys.get_status(writer), limit: :infinity, printable_limit: :infinity)
    refute status =~ "test-token"
    refute status =~ "secret-line"
    assert status =~ "{:points, 1}"
  end
end
