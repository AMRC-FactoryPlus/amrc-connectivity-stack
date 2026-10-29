# ACS Ingest
# A fake InfluxDB for tests
# Copyright 2026 University of Sheffield

defmodule Ingest.Test.FakeInflux do
  @moduledoc false

  # A minimal HTTP/1.1 server on a local port. Each request is passed,
  # as a map, to a handler function, which runs in the connection's
  # process and returns `{status, headers, body}`, or `:close` to close
  # the connection without answering. Connections are kept alive, as
  # Finch expects.

  use GenServer

  def start_link(handler), do: GenServer.start_link(__MODULE__, handler)

  def url(server), do: GenServer.call(server, :url)

  @impl true
  def init(handler) do
    {:ok, listen} = :gen_tcp.listen(0, [:binary, active: false, ip: {127, 0, 0, 1}])
    {:ok, port} = :inet.port(listen)
    spawn_link(fn -> accept(listen, handler) end)
    {:ok, %{listen: listen, port: port}}
  end

  @impl true
  def handle_call(:url, _from, state), do: {:reply, "http://127.0.0.1:#{state.port}", state}

  defp accept(listen, handler) do
    {:ok, socket} = :gen_tcp.accept(listen)

    # The connection's process waits until it owns the socket.
    pid =
      spawn_link(fn ->
        receive do
          :go -> serve(socket, handler)
        end
      end)

    :ok = :gen_tcp.controlling_process(socket, pid)
    send(pid, :go)
    accept(listen, handler)
  end

  defp serve(socket, handler) do
    with {:ok, request} <- read_request(socket),
         {status, headers, body} <- handler.(request) do
      :ok = :gen_tcp.send(socket, response(status, headers, body))
      serve(socket, handler)
    else
      _closed_or_close -> :gen_tcp.close(socket)
    end
  end

  defp read_request(socket) do
    :ok = :inet.setopts(socket, packet: :http_bin)

    with {:ok, {:http_request, method, {:abs_path, target}, _version}} <-
           :gen_tcp.recv(socket, 0),
         {:ok, headers} <- read_headers(socket, %{}),
         :ok <- :inet.setopts(socket, packet: :raw),
         {:ok, body} <- read_body(socket, headers) do
      uri = URI.parse(target)

      {:ok,
       %{
         method: method,
         path: uri.path,
         query: URI.decode_query(uri.query || ""),
         headers: headers,
         body: body
       }}
    end
  end

  defp read_headers(socket, headers) do
    case :gen_tcp.recv(socket, 0) do
      {:ok, {:http_header, _, name, _, value}} ->
        read_headers(socket, Map.put(headers, String.downcase(to_string(name)), value))

      {:ok, :http_eoh} ->
        {:ok, headers}

      other ->
        {:error, other}
    end
  end

  defp read_body(socket, headers) do
    case String.to_integer(Map.get(headers, "content-length", "0")) do
      0 -> {:ok, ""}
      length -> :gen_tcp.recv(socket, length)
    end
  end

  defp response(status, headers, body) do
    headers = [{"content-length", Integer.to_string(byte_size(body))} | headers]

    [
      "HTTP/1.1 #{status} Fake\r\n",
      Enum.map(headers, fn {name, value} -> [name, ": ", value, "\r\n"] end),
      "\r\n",
      body
    ]
  end
end
