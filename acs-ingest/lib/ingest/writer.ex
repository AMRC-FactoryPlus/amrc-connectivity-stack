# ACS Ingest
# Buffered writes to an InfluxDB bucket
# Copyright 2026 University of Sheffield

defmodule Ingest.Writer do
  @moduledoc """
  Writes line protocol to one InfluxDB bucket. It buffers what it's
  given, so the processes making points never wait for InfluxDB.

  Callers hand it lines with `write/3`, one call per Sparkplug payload.
  A write to InfluxDB starts when the buffer holds `:batch_size` points,
  or `:flush_interval` ms after points arrive in an empty buffer. Each
  write is a POST to `/api/v2/write` in a task, so the writer keeps
  buffering while it waits. A batch is made of whole calls to `write/3`,
  and holds at most `:batch_size` points unless one call has more.

  ## Failures

    * **Retried**, with the batch kept at the front of the buffer:
      network errors, timeouts, a write task that crashed, 5xx, 429,
      408, and 401, 403 and 404, which mean the token, org or bucket is
      wrong rather than the data. The first retry waits `:min_backoff`
      ms, doubling up to `:max_backoff`, or as long as a `Retry-After`
      header says (up to `:max_backoff`). No writes start meanwhile.
    * **Rejected:** InfluxDB's other 4xx answers mean the data is bad,
      so the batch is dropped with an error log.
    * **Dropped:** when the buffer holds more than `:buffer_limit`
      points, the oldest are dropped, with an error log at most every
      10 s.

  Writes to InfluxDB are idempotent, so a retry after a timeout that
  did reach InfluxDB stores nothing twice.

  ## Shutdown

  The writer traps exits. When it stops, it waits for writes in flight,
  then writes what is left in the buffer, giving up after nine-tenths of
  `:shutdown`. It logs any points it couldn't write.

  ## Options

    * `:name` - required. Registers the writer, and is the child's ID.
    * `:finch` - required. The `Finch` pool to write with.
    * `:url`, `:org`, `:bucket`, `:token` - required. Where to write,
      and the InfluxDB token to write with.
    * `:batch_size` - default 5000.
    * `:flush_interval` - in ms; default 1000.
    * `:buffer_limit` - in points; default 100,000.
    * `:max_writes` - writes in flight at once; default 1.
    * `:min_backoff`, `:max_backoff` - in ms; default 1000 and 60,000.
    * `:timeout` - for each write, in ms; default 10,000, as in the JS
      client.
    * `:shutdown` - in ms; default 20,000.
  """

  use GenServer

  require Logger

  @type option ::
          {:name, atom()}
          | {:finch, atom()}
          | {:url, String.t()}
          | {:org, String.t()}
          | {:bucket, String.t()}
          | {:token, String.t()}
          | {:batch_size, pos_integer()}
          | {:flush_interval, pos_integer()}
          | {:buffer_limit, pos_integer()}
          | {:max_writes, pos_integer()}
          | {:min_backoff, pos_integer()}
          | {:max_backoff, pos_integer()}
          | {:timeout, pos_integer()}
          | {:shutdown, pos_integer()}

  @type stats :: %{
          buffered: non_neg_integer(),
          writing: non_neg_integer(),
          written: non_neg_integer(),
          rejected: non_neg_integer(),
          dropped: non_neg_integer()
        }

  @defaults [
    batch_size: 5000,
    flush_interval: 1000,
    buffer_limit: 100_000,
    max_writes: 1,
    min_backoff: 1000,
    max_backoff: 60_000,
    timeout: 10_000,
    shutdown: 20_000
  ]

  # These mean the request's target is wrong, not its data, so a retry
  # can work once someone fixes it.
  @retried [401, 403, 404, 408, 429]

  @drop_report_interval 10_000

  @doc false
  def child_spec(opts) do
    %{
      id: Keyword.fetch!(opts, :name),
      start: {__MODULE__, :start_link, [opts]},
      shutdown: Keyword.get(opts, :shutdown, @defaults[:shutdown])
    }
  end

  @doc "Start a writer."
  @spec start_link([option()]) :: GenServer.on_start()
  def start_link(opts) do
    opts = Keyword.validate!(opts, [:name, :finch, :url, :org, :bucket, :token] ++ @defaults)
    GenServer.start_link(__MODULE__, opts, name: Keyword.fetch!(opts, :name))
  end

  @doc """
  Buffer `count` points of line protocol, each line ending in a newline.
  It never waits for InfluxDB.
  """
  @spec write(GenServer.server(), iodata(), pos_integer()) :: :ok
  def write(writer, lines, count) when is_integer(count) and count > 0 do
    # Copied once here, rather than as a list of small binaries.
    GenServer.cast(writer, {:write, IO.iodata_to_binary(lines), count})
  end

  @doc """
  Counts of points: in the buffer, in writes in flight, written,
  rejected by InfluxDB, and dropped because the buffer was full. The
  last three count from when the writer started.
  """
  @spec stats(GenServer.server()) :: stats()
  def stats(writer), do: GenServer.call(writer, :stats)

  @impl true
  def init(opts) do
    Process.flag(:trap_exit, true)

    query = [
      org: Keyword.fetch!(opts, :org),
      bucket: Keyword.fetch!(opts, :bucket),
      precision: "ns"
    ]

    url =
      opts
      |> Keyword.fetch!(:url)
      |> URI.parse()
      |> URI.append_path("/api/v2/write")
      |> URI.append_query(URI.encode_query(query))
      |> URI.to_string()

    request = %{
      finch: Keyword.fetch!(opts, :finch),
      url: url,
      headers: [
        {"authorization", "Token " <> Keyword.fetch!(opts, :token)},
        {"content-type", "text/plain; charset=utf-8"}
      ],
      timeout: opts[:timeout]
    }

    state =
      opts
      |> Keyword.take(Keyword.keys(@defaults) ++ [:bucket])
      |> Map.new()
      |> Map.merge(%{
        request: request,
        buffer: :queue.new(),
        buffered: 0,
        writes: %{},
        flush_timer: nil,
        flush_due: false,
        backoff: nil,
        retry_timer: nil,
        written: 0,
        rejected: 0,
        dropped: 0,
        unreported_drops: 0,
        drop_timer: nil
      })

    {:ok, state}
  end

  @impl true
  def handle_cast({:write, lines, count}, state) do
    state = %{state | buffer: :queue.in({lines, count}, state.buffer)}
    {:noreply, state |> add_buffered(count) |> advance()}
  end

  @impl true
  def handle_call(:stats, _from, state) do
    writing = state.writes |> Map.values() |> Enum.map(&elem(&1, 1)) |> Enum.sum()

    {:reply,
     %{
       buffered: state.buffered,
       writing: writing,
       written: state.written,
       rejected: state.rejected,
       dropped: state.dropped
     }, state}
  end

  @impl true
  def handle_info(:flush, state),
    do: {:noreply, advance(%{state | flush_timer: nil, flush_due: true})}

  # The batch put back after a failure may be short of a batch, so
  # write it as soon as the wait is over.
  def handle_info(:retry, state),
    do: {:noreply, advance(%{state | retry_timer: nil, flush_due: true})}

  def handle_info(:report_drops, state), do: {:noreply, report_drops(%{state | drop_timer: nil})}

  def handle_info({ref, result}, %{writes: writes} = state) when is_map_key(writes, ref) do
    Process.demonitor(ref, [:flush])
    {:noreply, write_done(state, ref, outcome(result))}
  end

  def handle_info({:DOWN, ref, :process, _pid, reason}, %{writes: writes} = state)
      when is_map_key(writes, ref) do
    {:noreply, write_done(state, ref, {:retry, "the write crashed: #{inspect(reason)}", nil})}
  end

  # Write tasks are linked, and we trap exits; their results come in the
  # messages above.
  def handle_info({:EXIT, _pid, _reason}, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, state) do
    deadline = System.monotonic_time(:millisecond) + div(state.shutdown * 9, 10)
    state |> await_writes(deadline) |> flush_all(deadline)
  end

  @impl true
  def format_status(status) do
    Map.replace_lazy(status, :state, fn state ->
      # The buffer can be large, and the headers hold the token.
      %{
        state
        | request: %{state.request | headers: :redacted},
          buffer: {:points, state.buffered},
          writes: Map.new(state.writes, fn {ref, {_batch, count}} -> {ref, {:points, count}} end)
      }
    end)
  end

  # Start the writes that are due, then make sure a flush is coming for
  # whatever is left.
  defp advance(state), do: state |> start_writes() |> schedule_flush()

  defp start_writes(state) do
    cond do
      state.retry_timer != nil ->
        state

      map_size(state.writes) >= state.max_writes ->
        state

      state.buffered == 0 ->
        state

      state.flush_due or state.buffered >= state.batch_size ->
        state |> start_write() |> start_writes()

      true ->
        state
    end
  end

  defp start_write(state) do
    {batch, count, buffer} = take_batch(state.buffer, state.batch_size)
    request = state.request
    task = Task.async(fn -> post(request, batch) end)

    %{
      state
      | buffer: buffer,
        buffered: state.buffered - count,
        writes: Map.put(state.writes, task.ref, {batch, count})
    }
  end

  # Whole calls to write/3, up to `max` points, but at least one call.
  defp take_batch(buffer, max, batch \\ [], count \\ 0) do
    case :queue.peek(buffer) do
      {:value, {_lines, n} = entry} when batch == [] or count + n <= max ->
        take_batch(:queue.drop(buffer), max, [entry | batch], count + n)

      _ ->
        {Enum.reverse(batch), count, buffer}
    end
  end

  # Points wait at most a flush interval once they reach an empty
  # buffer. Once a flush is due, writes carry on until the buffer is
  # empty.
  defp schedule_flush(%{buffered: 0} = state) do
    if state.flush_timer, do: Process.cancel_timer(state.flush_timer)
    %{state | flush_timer: nil, flush_due: false}
  end

  defp schedule_flush(%{flush_timer: nil, flush_due: false} = state),
    do: %{state | flush_timer: Process.send_after(self(), :flush, state.flush_interval)}

  defp schedule_flush(state), do: state

  defp post(request, batch) do
    body = Enum.map(batch, fn {lines, _count} -> lines end)

    :post
    |> Finch.build(request.url, request.headers, body)
    |> Finch.request(request.finch,
      receive_timeout: request.timeout,
      request_timeout: request.timeout
    )
  end

  defp outcome({:ok, %Finch.Response{status: status}}) when status in 200..299, do: :ok

  defp outcome({:ok, %Finch.Response{status: status} = response})
       when status in @retried or status >= 500,
       do: {:retry, "InfluxDB answered #{status}", retry_after(response)}

  defp outcome({:ok, %Finch.Response{status: status, body: body}}),
    do: {:reject, "InfluxDB answered #{status}: #{String.slice(body, 0, 500)}"}

  defp outcome({:error, exception}), do: {:retry, Exception.message(exception), nil}

  # Only the seconds form; an HTTP date falls back to the backoff.
  defp retry_after(%Finch.Response{headers: headers}) do
    with {_name, value} <-
           Enum.find(headers, fn {name, _} -> String.downcase(name) == "retry-after" end),
         {seconds, ""} when seconds >= 0 <- Integer.parse(String.trim(value)) do
      seconds * 1000
    else
      _ -> nil
    end
  end

  defp write_done(state, ref, outcome) do
    {{batch, count}, writes} = Map.pop!(state.writes, ref)
    state = %{state | writes: writes}

    state =
      case outcome do
        :ok -> written(state, count)
        {:reject, reason} -> rejected(state, count, reason)
        {:retry, reason, retry_after} -> retry(state, batch, count, reason, retry_after)
      end

    advance(state)
  end

  defp written(state, count) do
    if state.backoff, do: Logger.info("Writing to InfluxDB bucket #{state.bucket} again")
    %{state | written: state.written + count, backoff: nil}
  end

  defp rejected(state, count, reason) do
    Logger.error("Dropped #{points(count)} for InfluxDB bucket #{state.bucket}: #{reason}")
    %{state | rejected: state.rejected + count}
  end

  defp retry(state, batch, count, reason, retry_after) do
    backoff =
      case state.backoff do
        nil -> state.min_backoff
        backoff -> min(backoff * 2, state.max_backoff)
      end

    delay = min(retry_after || backoff, state.max_backoff)

    Logger.warning(
      "Writing #{points(count)} to InfluxDB bucket #{state.bucket} failed: #{reason}; " <>
        "retrying in #{delay} ms"
    )

    if state.retry_timer, do: Process.cancel_timer(state.retry_timer)

    %{
      state
      | buffer: :queue.join(:queue.from_list(batch), state.buffer),
        backoff: backoff,
        retry_timer: Process.send_after(self(), :retry, delay)
    }
    |> add_buffered(count)
  end

  # Add to the buffer's count, dropping the oldest points while it is
  # over the limit.
  defp add_buffered(state, count), do: drop_oldest(%{state | buffered: state.buffered + count})

  defp drop_oldest(%{buffered: buffered, buffer_limit: limit} = state) when buffered <= limit,
    do: state

  defp drop_oldest(state) do
    {{:value, {_lines, count}}, buffer} = :queue.out(state.buffer)

    state = %{
      state
      | buffer: buffer,
        buffered: state.buffered - count,
        dropped: state.dropped + count,
        unreported_drops: state.unreported_drops + count
    }

    cond do
      state.buffered > state.buffer_limit -> drop_oldest(state)
      state.drop_timer -> state
      true -> report_drops(state)
    end
  end

  # Log drops now, then at most every @drop_report_interval while they
  # go on.
  defp report_drops(%{unreported_drops: 0} = state), do: state

  defp report_drops(state) do
    Logger.error(
      "The buffer for InfluxDB bucket #{state.bucket} is over #{state.buffer_limit} points: " <>
        "dropped the oldest #{points(state.unreported_drops)}, #{state.dropped} since starting"
    )

    timer = Process.send_after(self(), :report_drops, @drop_report_interval)
    %{state | unreported_drops: 0, drop_timer: timer}
  end

  # Shutting down

  defp await_writes(state, deadline) do
    Enum.reduce(state.writes, %{state | writes: %{}}, fn {ref, {batch, count}}, state ->
      receive do
        {^ref, result} ->
          Process.demonitor(ref, [:flush])

          if outcome(result) == :ok,
            do: %{state | written: state.written + count},
            else: requeue(state, batch, count)

        {:DOWN, ^ref, :process, _pid, _reason} ->
          requeue(state, batch, count)
      after
        remaining(deadline) -> requeue(state, batch, count)
      end
    end)
  end

  defp requeue(state, batch, count) do
    buffer = :queue.join(:queue.from_list(batch), state.buffer)
    %{state | buffer: buffer, buffered: state.buffered + count}
  end

  defp flush_all(%{buffered: 0}, _deadline), do: :ok

  # Write the buffer in batches until it's empty, InfluxDB fails, or
  # time runs out.
  defp flush_all(state, deadline) do
    {batch, count, buffer} = take_batch(state.buffer, state.batch_size)
    state = %{state | buffer: buffer, buffered: state.buffered - count}

    case remaining(deadline) do
      0 ->
        lost(state, count, "out of time")

      time ->
        case outcome(post(%{state.request | timeout: min(state.request.timeout, time)}, batch)) do
          :ok -> state |> written(count) |> flush_all(deadline)
          {:reject, reason} -> state |> rejected(count, reason) |> flush_all(deadline)
          {:retry, reason, _retry_after} -> lost(state, count, reason)
        end
    end
  end

  defp lost(state, count, reason) do
    Logger.error(
      "Lost #{points(state.buffered + count)} for InfluxDB bucket #{state.bucket} " <>
        "when stopping: #{reason}"
    )
  end

  defp remaining(deadline), do: max(deadline - System.monotonic_time(:millisecond), 0)

  defp points(1), do: "1 point"
  defp points(n), do: "#{n} points"
end
