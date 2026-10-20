# ACS Service Client
# Bearer tokens and service URLs for HTTP requests
# Copyright 2026 University of Sheffield

defmodule FPlus.HTTP.Tokens do
  @moduledoc false

  # Caches service URLs from the Directory and bearer tokens from each
  # service's /token endpoint. Each is fetched in a task, at most once at
  # a time per service; callers asking while a fetch is running wait for
  # its result. Tokens are fetched again shortly before they expire, or
  # when a service refuses one.

  use GenServer

  alias FPlus.Credentials

  # Fetch a new token when the cached one has less than this left.
  @expiry_margin 60

  defstruct [:credentials, :finch, :http, urls: %{}, tokens: %{}, pending: %{}]

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.fetch!(opts, :name))
  end

  @impl true
  def init(opts) do
    opts =
      Keyword.validate!(opts, [
        :name,
        :credentials,
        :finch,
        :http,
        :directory_url,
        service_urls: %{}
      ])

    directory_url = opts[:directory_url] || raise ArgumentError, ":directory_url is required"
    urls = Map.put(opts[:service_urls], FPlus.Service.directory(), directory_url)

    state = %__MODULE__{
      credentials: Keyword.fetch!(opts, :credentials),
      finch: Keyword.fetch!(opts, :finch),
      http: Keyword.fetch!(opts, :http),
      urls: urls
    }

    {:ok, state}
  end

  @impl true
  def handle_call({:service_url, service}, from, state) do
    case state.urls do
      %{^service => url} -> {:reply, {:ok, url}, state}
      _ -> {:noreply, fetch(state, {:url, service}, from)}
    end
  end

  def handle_call({:token, base, bad}, from, state) do
    case cached_token(state, base) do
      token when is_binary(token) and token != bad -> {:reply, {:ok, token}, state}
      _ -> {:noreply, fetch(state, {:token, base}, from)}
    end
  end

  @impl true
  def handle_info({ref, result}, state) when is_reference(ref) do
    Process.demonitor(ref, [:flush])

    case Enum.find(state.pending, fn {_key, {r, _froms}} -> r == ref end) do
      nil ->
        {:noreply, state}

      {key, {_ref, froms}} ->
        state = %{state | pending: Map.delete(state.pending, key)}
        {reply, state} = store(state, key, result)
        Enum.each(froms, &GenServer.reply(&1, reply))
        {:noreply, state}
    end
  end

  @impl true
  def format_status(status) do
    Map.replace_lazy(status, :state, fn
      %__MODULE__{} = state ->
        tokens =
          Map.new(state.tokens, fn {base, {_token, expires}} -> {base, {:redacted, expires}} end)

        %{state | tokens: tokens}

      other ->
        other
    end)
  end

  # Fetching

  # Join a fetch already running for the key, or start one.
  defp fetch(state, key, from) do
    case state.pending do
      %{^key => {ref, froms}} ->
        put_in(state.pending[key], {ref, [from | froms]})

      _ ->
        task = Task.async(fn -> run(state, key) end)
        put_in(state.pending[key], {task.ref, [from]})
    end
  end

  defp run(state, {:url, service}), do: FPlus.Directory.get_service_url(state.http, service)
  defp run(state, {:token, base}), do: fetch_token(state.finch, state.credentials, base)

  defp store(state, {:url, service}, {:ok, url} = reply),
    do: {reply, put_in(state.urls[service], url)}

  defp store(state, {:token, base}, {:ok, token, expires}),
    do: {{:ok, token}, put_in(state.tokens[base], {token, expires})}

  defp store(state, _key, {:error, _reason} = error), do: {error, state}

  defp cached_token(state, base) do
    case state.tokens do
      %{^base => {token, nil}} ->
        token

      %{^base => {token, expires}} ->
        if expires - @expiry_margin > System.os_time(:second), do: token

      _ ->
        nil
    end
  end

  # The token exchange: authenticate to the service's /token endpoint with
  # Kerberos, and check its reply before trusting the token it gives.
  defp fetch_token(finch, credentials, base) do
    uri = URI.parse(base)
    url = uri |> URI.merge("/token") |> URI.to_string()

    with {:ok, gss_token, context} <- Credentials.initiate(credentials, "HTTP", uri.host),
         {:ok, response} <- post_token(finch, url, gss_token),
         :ok <- Credentials.verify(context, negotiate_reply(response)),
         {:ok, %{"token" => token} = json} when is_binary(token) <- JSON.decode(response.body) do
      {:ok, token, expires(json["expiry"])}
    else
      {:ok, _json} -> {:error, :bad_token_response}
      {:error, %JSON.DecodeError{}} -> {:error, :bad_token_response}
      {:error, reason} -> {:error, reason}
    end
  end

  defp post_token(finch, url, gss_token) do
    headers = [{"authorization", "Negotiate " <> Base.encode64(gss_token)}]

    case :post |> Finch.build(url, headers, "") |> Finch.request(finch) do
      {:ok, %Finch.Response{status: 200} = response} -> {:ok, response}
      {:ok, %Finch.Response{status: status}} -> {:error, {:token_refused, status}}
      {:error, reason} -> {:error, reason}
    end
  end

  # The service's GSS-API reply, from WWW-Authenticate: Negotiate <base64>.
  defp negotiate_reply(%Finch.Response{headers: headers}) do
    Enum.find_value(headers, fn {key, value} ->
      with "www-authenticate" <- String.downcase(key),
           "Negotiate " <> encoded <- value,
           {:ok, reply} <- Base.decode64(encoded) do
        reply
      else
        _other -> nil
      end
    end)
  end

  # The token's expiry, in milliseconds since the epoch.
  defp expires(ms) when is_integer(ms), do: div(ms, 1000)
  defp expires(_none), do: nil
end
