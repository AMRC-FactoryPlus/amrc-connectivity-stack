# ACS Service Client
# HTTP requests to Factory+ services
# Copyright 2026 University of Sheffield

defmodule FPlus.HTTP do
  @moduledoc """
  HTTP requests to Factory+ services, authenticated with Kerberos.

  Add it to a supervision tree after `FPlus.Credentials`:

      children = [
        {FPlus.Credentials, name: MyApp.Credentials, principal: ..., keytab: ...},
        {FPlus.HTTP,
         name: MyApp.HTTP,
         credentials: MyApp.Credentials,
         directory_url: "http://directory.acs.localhost"}
      ]

  `request/5` finds a service's URL through the Directory, gets a bearer
  token from the service's `/token` endpoint, and makes the request in
  the calling process. Service URLs and tokens are cached, and a token
  is fetched again, and the request retried once, if the service answers
  401. The token exchange authenticates with Kerberos and checks the
  service's reply, as the JS client does.

  ## Options

    * `:name` - required. An atom naming the client for the other
      functions.
    * `:credentials` - required. The `FPlus.Credentials` process.
    * `:directory_url` - required. The Directory's URL, which in ACS pods
      is in `DIRECTORY_URL`.
    * `:service_urls` - URLs to use instead of asking the Directory, as a
      map from service UUID to URL.
  """

  use Supervisor

  alias FPlus.HTTP.Tokens

  @type option ::
          {:name, atom()}
          | {:credentials, GenServer.server()}
          | {:directory_url, String.t()}
          | {:service_urls, %{String.t() => String.t()}}

  @type response :: %{
          status: non_neg_integer(),
          headers: [{String.t(), String.t()}],
          body: term()
        }

  # Token fetches can wait on the KDC, so allow longer than the default.
  @call_timeout :timer.seconds(30)

  @doc "Start the client's supervisor."
  @spec start_link([option()]) :: Supervisor.on_start()
  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: Keyword.fetch!(opts, :name))
  end

  @impl true
  def init(opts) do
    name = Keyword.fetch!(opts, :name)
    tokens_opts = Keyword.merge(opts, name: tokens(name), finch: finch(name), http: name)

    children = [
      {Finch, name: finch(name)},
      {Tokens, tokens_opts}
    ]

    Supervisor.init(children, strategy: :rest_for_one)
  end

  @doc """
  Make a request to a service.

  `path` is relative to the service's URL. A JSON body is given with the
  `:json` option; other options are `:headers` and `:body`. A JSON
  response is decoded. Returns `{:ok, response}` whatever the status,
  and `{:error, reason}` only if no response came back.
  """
  @spec request(atom(), String.t(), atom(), String.t(), keyword()) ::
          {:ok, response()} | {:error, term()}
  def request(name, service, method, path, opts \\ []) do
    opts = Keyword.validate!(opts, [:json, :body, headers: []])

    with {:ok, base} <- service_url(name, service),
         {:ok, token} <- token(name, base) do
      case send_request(name, base, token, method, path, opts) do
        {:ok, %{status: 401}} -> retry(name, base, token, method, path, opts)
        other -> other
      end
    end
  end

  @doc """
  The URL of a service, from the `:service_urls` option or the
  Directory.
  """
  @spec service_url(atom(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def service_url(name, service), do: call(name, {:service_url, service})

  # A token the service refused may have expired; ask for a new one.
  defp retry(name, base, bad_token, method, path, opts) do
    with {:ok, token} <- call(name, {:token, base, bad_token}) do
      send_request(name, base, token, method, path, opts)
    end
  end

  defp token(name, base), do: call(name, {:token, base, nil})

  defp call(name, request) do
    GenServer.call(tokens(name), request, @call_timeout)
  catch
    :exit, {:timeout, _} -> {:error, :timeout}
  end

  defp send_request(name, base, token, method, path, opts) do
    {headers, body} =
      case Keyword.fetch(opts, :json) do
        {:ok, json} -> {[{"content-type", "application/json"}], JSON.encode!(json)}
        :error -> {[], opts[:body]}
      end

    headers = [{"authorization", "Bearer " <> token} | headers ++ opts[:headers]]
    url = base |> URI.parse() |> URI.merge(path) |> URI.to_string()

    case method |> Finch.build(url, headers, body) |> Finch.request(finch(name)) do
      {:ok, response} -> {:ok, decode(response)}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc false
  @spec decode(Finch.Response.t()) :: response()
  def decode(%Finch.Response{status: status, headers: headers, body: body}) do
    json? =
      Enum.any?(headers, fn {key, value} ->
        String.downcase(key) == "content-type" and value =~ ~r{^application/(.+\+)?json}i
      end)

    body =
      with true <- json? and body != "",
           {:ok, decoded} <- JSON.decode(body) do
        decoded
      else
        _not_json -> body
      end

    %{status: status, headers: headers, body: body}
  end

  # Strings, not aliases: Tokens here would be FPlus.HTTP.Tokens.
  defp tokens(name), do: Module.concat(name, "Tokens")
  @doc false
  def finch(name), do: Module.concat(name, "Finch")
end
