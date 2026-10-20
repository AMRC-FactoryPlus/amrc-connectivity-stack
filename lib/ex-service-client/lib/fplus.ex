# ACS Service Client
# Library entry point
# Copyright 2026 University of Sheffield

defmodule FPlus do
  @moduledoc """
  A client for Factory+ services, for Elixir services in ACS.

  Add the whole client to a supervision tree with one child spec,
  reading its options from the environment as the JS client does:

      children = [
        {FPlus, [name: MyApp.FPlus] ++ FPlus.opts_from_env()}
      ]

  This starts `FPlus.Credentials`, `FPlus.HTTP` and `FPlus.MQTT` under
  one supervisor. Reach them through their names:

      :ok = FPlus.MQTT.subscribe(FPlus.mqtt(MyApp.FPlus), "spBv1.0/#")
      :ok = FPlus.CmdEsc.rebirth(FPlus.http(MyApp.FPlus), address)

  Each part connects after it starts, so a KDC, Directory or broker
  that is down doesn't stop the application starting. The parts restart
  independently, so a restart of the credentials process doesn't drop a
  working MQTT connection.

  ## Options

    * `:name` - required. An atom naming the client.
    * `:directory_url` - required. The Directory's URL.
    * `:keytab`, `:password`, `:principal`, `:realm`, `:kdc` - how to log
      in; see `FPlus.Credentials`.
    * `:service_urls` - URLs to use instead of asking the Directory; see
      `FPlus.HTTP`.
    * `:mqtt_url` - the MQTT broker. Without it, the broker is found in
      the Directory.
    * `:mqtt` - `false` to leave MQTT out, for services that only use
      HTTP.
    * `:client_id` - the MQTT client ID.
  """

  use Supervisor

  alias FPlus.Service

  @credential_options [:principal, :realm, :keytab, :password, :kdc]

  @doc "Start the client's supervisor."
  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: Keyword.fetch!(opts, :name))
  end

  @impl true
  def init(opts) do
    opts =
      Keyword.validate!(
        opts,
        [:name, :directory_url, :service_urls, :mqtt_url, :client_id, mqtt: true] ++
          @credential_options
      )

    name = Keyword.fetch!(opts, :name)
    directory_url = opts[:directory_url] || raise ArgumentError, ":directory_url is required"

    credentials =
      {FPlus.Credentials, [name: credentials(name)] ++ Keyword.take(opts, @credential_options)}

    http =
      {FPlus.HTTP,
       [name: http(name), credentials: credentials(name), directory_url: directory_url] ++
         Keyword.take(opts, [:service_urls])}

    mqtt =
      {FPlus.MQTT,
       [name: mqtt(name), credentials: credentials(name), http: http(name)] ++
         Enum.flat_map([url: opts[:mqtt_url], client_id: opts[:client_id]], fn
           {_key, nil} -> []
           option -> [option]
         end)}

    children = [credentials, http | if(opts[:mqtt], do: [mqtt], else: [])]
    Supervisor.init(children, strategy: :one_for_one)
  end

  @doc "The name of a client's `FPlus.Credentials` process."
  @spec credentials(atom()) :: atom()
  def credentials(name), do: Module.concat(name, "Credentials")

  @doc "The name of a client's `FPlus.HTTP` client."
  @spec http(atom()) :: atom()
  def http(name), do: Module.concat(name, "HTTP")

  @doc "The name of a client's `FPlus.MQTT` connection."
  @spec mqtt(atom()) :: atom()
  def mqtt(name), do: Module.concat(name, "MQTT")

  @doc """
  Options from the environment, using the variables the JS client and
  ACS's Helm chart use:

    * `DIRECTORY_URL` (required) - `:directory_url`
    * `CLIENT_KEYTAB` (required) - `:keytab`; the principal comes from
      the keytab
    * `MQTT_URL` - `:mqtt_url`
    * `CONFIGDB_URL`, `AUTHN_URL` - entries in `:service_urls`

  The KDC comes from `KRB5_CONFIG`, which kerlberos reads itself.
  """
  @spec opts_from_env(%{String.t() => String.t()}) :: keyword()
  def opts_from_env(env \\ System.get_env()) do
    required = fn variable ->
      case env[variable] do
        value when is_binary(value) and value != "" -> value
        _unset -> raise ArgumentError, "#{variable} isn't set"
      end
    end

    service_urls =
      for {variable, service} <- [
            {"CONFIGDB_URL", Service.configdb()},
            {"AUTHN_URL", Service.authentication()}
          ],
          url = env[variable],
          url not in [nil, ""],
          into: %{},
          do: {service, url}

    [directory_url: required.("DIRECTORY_URL"), keytab: required.("CLIENT_KEYTAB")] ++
      if(env["MQTT_URL"] in [nil, ""], do: [], else: [mqtt_url: env["MQTT_URL"]]) ++
      if(service_urls == %{}, do: [], else: [service_urls: service_urls])
  end
end
