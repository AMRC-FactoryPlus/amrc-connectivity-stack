# ACS Service Client
# Kerberos credentials
# Copyright 2026 University of Sheffield

defmodule FPlus.Credentials do
  @moduledoc """
  Kerberos credentials for a service.

  A `FPlus.Credentials` process logs in to the KDC as a principal, from a
  keytab or with a password, and logs in again before the ticket-granting
  ticket (TGT) expires. It caches service tickets. `initiate/4` builds the
  GSS-API token that authenticates to a service, and `verify/2` checks
  the service's reply.

  The process logs in after it has started, not during, so a KDC that is
  down doesn't stop the application starting. Until a login succeeds,
  `initiate/4` returns `{:error, :unavailable}`, and the process retries
  with backoff. Logins and ticket requests run in tasks, so a slow KDC
  never blocks the process.

  Passwords, keys and tickets are kept out of crash reports and
  `:sys.get_status/1`, and errors from Kerberos are reduced to their
  kind, as the calls that fail carry those secrets.

  ## Options

    * `:principal` - required. The principal to log in as, such as
      `"sv1warehouse@ACS.LOCALHOST"`.
    * `:realm` - the realm, if `:principal` doesn't include one.
    * `:keytab` - the path of a keytab holding the principal's keys.
    * `:password` - the principal's password. Give either `:keytab` or
      `:password`.
    * `:kdc` - the KDCs to use, as `{host, port}` tuples. Without it,
      kerlberos reads the files in `KRB5_CONFIG`, or `/etc/krb5.conf`,
      and DNS.
    * `:name` - a name to register the process under.
  """

  use GenServer

  require Logger

  # Retry a failed login after this long, doubling up to the maximum.
  @min_retry :timer.seconds(1)
  @max_retry :timer.seconds(60)

  # Log in again when this fraction of the TGT's remaining lifetime has
  # passed, but not sooner than the minimum.
  @renew_fraction 0.75
  @min_renew :timer.seconds(30)

  # Fetch a new service ticket when the cached one has less than this
  # left, so a connection never authenticates with one about to expire.
  @ticket_margin 60

  @type option ::
          {:principal, String.t()}
          | {:realm, String.t()}
          | {:keytab, Path.t()}
          | {:password, String.t()}
          | {:kdc, [{String.t(), :inet.port_number()}]}
          | {:name, GenServer.name()}

  @typedoc "The state of a GSS-API context between `initiate/4` and `verify/2`."
  @type context :: :gss_mechanism.state()

  @doc """
  Start a credentials process.

  Fails if the options are wrong or the keytab can't be read or has no
  keys for the principal. Doesn't wait for the KDC.
  """
  @spec start_link([option()]) :: GenServer.on_start()
  def start_link(opts) do
    {name, opts} = Keyword.pop(opts, :name)
    GenServer.start_link(__MODULE__, opts, if(name, do: [name: name], else: []))
  end

  @doc """
  Build the token that authenticates to `service` on `host`, such as
  `"mqtt"` on `"mqtt.acs.localhost"`.

  Returns the token to send, and a context for checking the service's
  reply with `verify/2`. Returns `{:error, :unavailable}` until the
  process has logged in.
  """
  @spec initiate(GenServer.server(), String.t(), String.t(), timeout()) ::
          {:ok, binary(), context()} | {:error, term()}
  def initiate(server, service, host, timeout \\ :timer.seconds(10)) do
    principal = [String.to_charlist(service), String.to_charlist(host)]

    with {:ok, ticket} <- call(server, {:ticket, principal}, timeout) do
      case :gss_krb5.initiate(%{ticket: ticket, chan_bindings: <<>>, mutual_auth: true}) do
        {:continue, token, context} -> {:ok, token, context}
        {:ok, token, context} -> {:ok, token, context}
        {:error, reason} -> {:error, {:gss, gss_reason(reason)}}
      end
    end
  end

  @doc """
  Check the service's reply to a token from `initiate/4`, which proves
  the service is who it claims to be.
  """
  @spec verify(context(), binary() | nil) :: :ok | {:error, term()}
  def verify(_context, nil), do: {:error, :no_reply_token}

  def verify(context, token) when is_binary(token) do
    case :gss_krb5.continue(token, context) do
      {:ok, _context} -> :ok
      {:continue, _token, _context} -> {:error, {:gss, :unexpected_token}}
      {:error, reason} -> {:error, {:gss, gss_reason(reason)}}
      {:error, reason, _context} -> {:error, {:gss, gss_reason(reason)}}
    end
  end

  @doc """
  Whether the process has a TGT, and until when.
  """
  @spec status(GenServer.server()) :: %{
          principal: String.t(),
          logged_in: boolean(),
          expires: DateTime.t() | nil
        }
  def status(server), do: GenServer.call(server, :status)

  # A Kerberos error code from the service is safe and worth keeping.
  # Other reasons can hold token bytes or stack frames.
  defp gss_reason({:krb_error, code}) when is_atom(code), do: {:krb_error, code}
  defp gss_reason(reason), do: :krb_redact.reason(reason)

  defp call(server, request, timeout) do
    GenServer.call(server, request, timeout)
  catch
    :exit, {:timeout, _} -> {:error, :timeout}
  end

  # The process

  defstruct [
    :principal,
    :realm,
    :credential,
    :tgt,
    :tgt_expires,
    :login_task,
    retry: @min_retry,
    tickets: %{},
    pending: %{}
  ]

  @impl true
  def init(opts) do
    opts = Keyword.validate!(opts, [:principal, :realm, :keytab, :password, :kdc])
    {principal, realm} = parse_principal(opts[:principal], opts[:realm])
    configure_kdc(realm, opts[:kdc])

    case credential(principal, realm, opts) do
      {:ok, credential} ->
        state = %__MODULE__{principal: principal, realm: realm, credential: credential}
        {:ok, state, {:continue, :login}}

      {:error, reason} ->
        {:stop, reason}
    end
  end

  @impl true
  def handle_continue(:login, state), do: {:noreply, start_login(state)}

  @impl true
  def handle_call(:status, _from, state) do
    status = %{
      principal: name(state),
      logged_in: logged_in?(state),
      expires: state.tgt_expires && DateTime.from_unix!(state.tgt_expires)
    }

    {:reply, status, state}
  end

  def handle_call({:ticket, service}, from, state) do
    cond do
      not logged_in?(state) ->
        {:reply, {:error, :unavailable}, state}

      ticket = cached_ticket(state, service) ->
        {:reply, {:ok, ticket}, state}

      Map.has_key?(state.pending, service) ->
        {:noreply,
         update_in(state.pending[service], fn {ref, froms} -> {ref, [from | froms]} end)}

      true ->
        {:noreply, fetch_ticket(state, service, from)}
    end
  end

  @impl true
  def handle_info(:login, state), do: {:noreply, start_login(state)}

  def handle_info({ref, result}, %{login_task: ref} = state) do
    Process.demonitor(ref, [:flush])
    {:noreply, login_done(%{state | login_task: nil}, result)}
  end

  def handle_info({ref, result}, state) when is_reference(ref) do
    Process.demonitor(ref, [:flush])
    {:noreply, ticket_done(state, ref, result)}
  end

  @impl true
  def format_status(status) do
    status
    |> Map.replace_lazy(:state, &redact_state/1)
    |> Map.replace_lazy(:message, &redact_message/1)
    |> Map.replace_lazy(:reason, &:krb_redact.reason/1)
  end

  # Logging in

  defp start_login(%{login_task: ref} = state) when is_reference(ref), do: state

  defp start_login(state) do
    %{principal: principal, realm: realm, credential: credential} = state
    task = Task.async(fn -> authenticate(realm, principal, credential) end)
    %{state | login_task: task.ref}
  end

  defp authenticate(realm, principal, {:keytab, keytab}),
    do: with_realm(realm, &:krb_realm.authenticate(&1, principal, <<>>, %{keytab: keytab}))

  defp authenticate(realm, principal, {:password, password}),
    do: with_realm(realm, &:krb_realm.authenticate(&1, principal, password))

  defp login_done(state, {:ok, tgt}) do
    expires = krb_time(tgt.endtime)
    now = System.os_time(:second)
    renew_in = max(round((expires - now) * 1000 * @renew_fraction), @min_renew)
    Process.send_after(self(), :login, renew_in)

    Logger.info(
      "Logged in to Kerberos as #{name(state)}, TGT until #{DateTime.from_unix!(expires)}"
    )

    %{state | tgt: tgt, tgt_expires: expires, retry: @min_retry}
  end

  defp login_done(state, {:error, reason}) do
    Logger.warning(
      "Kerberos login as #{name(state)} failed: #{inspect(reason)}; retrying in #{state.retry} ms"
    )

    Process.send_after(self(), :login, state.retry)
    %{state | retry: min(state.retry * 2, @max_retry)}
  end

  defp logged_in?(%{tgt_expires: nil}), do: false
  defp logged_in?(%{tgt_expires: expires}), do: expires > System.os_time(:second)

  # Service tickets

  defp cached_ticket(state, service) do
    case state.tickets do
      %{^service => {ticket, expires}} ->
        if expires - @ticket_margin > System.os_time(:second), do: ticket

      _ ->
        nil
    end
  end

  defp fetch_ticket(state, service, from) do
    %{realm: realm, tgt: tgt} = state
    task = Task.async(fn -> with_realm(realm, &:krb_realm.obtain_ticket(&1, tgt, service)) end)
    put_in(state.pending[service], {task.ref, [from]})
  end

  defp ticket_done(state, ref, result) do
    case Enum.find(state.pending, fn {_service, {r, _froms}} -> r == ref end) do
      nil ->
        state

      {service, {_ref, froms}} ->
        Enum.each(froms, &GenServer.reply(&1, result))
        state = %{state | pending: Map.delete(state.pending, service)}

        case result do
          {:ok, ticket} -> put_in(state.tickets[service], {ticket, krb_time(ticket.endtime)})
          {:error, _reason} -> state
        end
    end
  end

  # Run a call into kerlberos against the realm's client process.
  defp with_realm(realm, fun) do
    case :krb_realm.open(realm) do
      {:ok, pid} -> safely(fn -> fun.(pid) end)
      {:error, reason} -> {:error, reason}
    end
  end

  # Calls into kerlberos that fail exit with the request, which holds the
  # password, keytab or TGT. Keep only the kind of error.
  defp safely(fun) do
    fun.()
  catch
    kind, reason -> {:error, {kind, :krb_redact.reason(reason)}}
  end

  # Options

  defp parse_principal(nil, _realm), do: raise(ArgumentError, ":principal is required")

  defp parse_principal(principal, realm) do
    {name, realm} =
      case String.split(principal, "@", parts: 2) do
        [name, realm] -> {name, realm}
        [name] when is_binary(realm) -> {name, realm}
        [_name] -> raise ArgumentError, "#{principal} has no realm, and :realm isn't given"
      end

    {name |> String.split("/") |> Enum.map(&String.to_charlist/1), String.to_charlist(realm)}
  end

  defp credential(principal, realm, opts) do
    case {opts[:keytab], opts[:password]} do
      {nil, nil} -> raise ArgumentError, "give :keytab or :password"
      {path, nil} -> keytab(path, principal, realm)
      {nil, password} -> {:ok, {:password, password}}
      {_path, _password} -> raise ArgumentError, "give :keytab or :password, not both"
    end
  end

  # krb_mit_keytab:file/1 crashes on a read error, so read the file here.
  # A parse error can hold keytab bytes, so keep only its kind.
  defp keytab(path, principal, realm) do
    with {:ok, data} <- File.read(path),
         {:ok, entries} <- :krb_mit_keytab.parse(data) do
      case Enum.filter(entries, &(&1.principal == principal and &1.realm == realm)) do
        [] -> {:error, {:no_keytab_keys, path}}
        keys -> {:ok, {:keytab, keys}}
      end
    else
      {:error, reason} -> {:error, {:keytab, path, :krb_redact.reason(reason)}}
    end
  end

  # kerlberos reads its realms from the application environment, then
  # krb5.conf and DNS.
  defp configure_kdc(_realm, nil), do: :ok

  defp configure_kdc(realm, kdcs) do
    kdc = Enum.map(kdcs, fn {host, port} -> {String.to_charlist(host), port} end)
    realms = Application.get_env(:kerlberos, :realms, [])
    entry = {realm, [kdc: kdc, use_dns: false]}
    Application.put_env(:kerlberos, :realms, List.keystore(realms, realm, 0, entry))
  end

  # Helpers

  defp name(%{principal: principal, realm: realm}),
    do: Enum.join(principal, "/") <> "@" <> List.to_string(realm)

  # Kerberos times are GeneralizedTime strings, such as "20261020103000Z".
  defp krb_time(
         <<y::binary-4, mo::binary-2, d::binary-2, h::binary-2, mi::binary-2, s::binary-2, "Z">>
       ) do
    {:ok, datetime, 0} = DateTime.from_iso8601("#{y}-#{mo}-#{d}T#{h}:#{mi}:#{s}Z")
    DateTime.to_unix(datetime)
  end

  defp redact_state(%__MODULE__{} = state) do
    %{
      state
      | credential: {elem(state.credential, 0), :redacted},
        tgt: state.tgt && :redacted,
        tickets:
          Map.new(state.tickets, fn {service, {_ticket, expires}} ->
            {service, {:redacted, expires}}
          end)
    }
  end

  defp redact_state(other), do: other

  # A login or ticket result arrives as a message from its task.
  defp redact_message({ref, {:ok, _ticket}}) when is_reference(ref), do: {ref, {:ok, :redacted}}
  defp redact_message(message), do: message
end
