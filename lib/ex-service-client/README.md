# ACS Service Client (Elixir)

A client for Factory+ services, for Elixir services in ACS. Services use
it through a path dependency, which also brings in the Sparkplug library
and the kerlberos fork:

```elixir
{:fplus, path: "../lib/ex-service-client"}
```

## Using it

Add the whole client to the application's supervision tree, reading its
options from the environment ACS pods are given (`DIRECTORY_URL`,
`CLIENT_KEYTAB`, and `KRB5_CONFIG` for the KDC):

```elixir
children = [
  {FPlus, [name: MyApp.FPlus] ++ FPlus.opts_from_env()}
]

:ok = FPlus.MQTT.subscribe(FPlus.mqtt(MyApp.FPlus), "spBv1.0/#")
:ok = FPlus.CmdEsc.rebirth(FPlus.http(MyApp.FPlus), %{group: "Site_1", node: "Edge_1"})
```

This starts `FPlus.Credentials`, `FPlus.HTTP` and `FPlus.MQTT`. The
principal comes from the keytab, and the MQTT broker from the Directory
unless `MQTT_URL` is set; `CONFIGDB_URL` and `AUTHN_URL` override the
Directory too. `mqtt: false` leaves MQTT out. The sections below
describe each part, which can also be started on its own.

## Design

- An application adds the client to its own supervision tree, rather
  than the client starting processes of its own.
- Processes hold only the state that must outlive a single call:
  Kerberos credentials, the MQTT connection, and caches of tokens and
  service URLs. There is no process per Factory+ service.
- Calls to a service are plain functions in a module per service, which
  run in the caller's process. They are named after the JS client's
  methods.

## Status

- **Credentials** (`FPlus.Credentials`): Kerberos login from a keytab
  or a password, renewal before the TGT expires, service-ticket caching,
  and the GSS-API tokens that authenticate to a service.
- **MQTT** (`FPlus.MQTT`): an MQTT 5 connection to the broker,
  authenticated with Kerberos, with subscriptions that survive
  reconnects.
- **HTTP** (`FPlus.HTTP`): requests to Factory+ services, with service
  discovery through the Directory and bearer tokens from Kerberos, plus
  `FPlus.Directory` and `FPlus.CmdEsc` (rebirth requests).
- **The whole client** (`FPlus`): one child spec, with options from the
  environment.

## Credentials

```elixir
children = [
  {FPlus.Credentials,
   name: MyApp.Credentials,
   principal: "sv1warehouse@ACS.LOCALHOST",
   keytab: "/keytabs/client"}
]

{:ok, token, context} = FPlus.Credentials.initiate(MyApp.Credentials, "mqtt", "mqtt.acs.localhost")
# Send the token to the service; check its reply with verify/2.
:ok = FPlus.Credentials.verify(context, reply)
```

The process logs in after it starts, so a KDC that is down doesn't stop
the application starting; `initiate/4` returns `{:error, :unavailable}`
until it has logged in. Each token can be used once, so make a new one
for every connection attempt.

Without the `:kdc` option, kerlberos finds the KDC from `KRB5_CONFIG`
(as ACS pods set it), or `/etc/krb5.conf`, and DNS.

## MQTT

```elixir
children = [
  {FPlus.Credentials, name: MyApp.Credentials, ...},
  {FPlus.MQTT,
   name: MyApp.MQTT,
   credentials: MyApp.Credentials,
   url: "mqtt://mqtt.acs.localhost:1883"}
]

:ok = FPlus.MQTT.subscribe(MyApp.MQTT, "spBv1.0/#")

receive do
  {:fplus_mqtt, topic, payload, _properties} ->
    {:ok, payload} = SparkplugB.decode(payload, timestamp_unit: :auto)
end
```

The connection is made after the process starts. Each attempt
authenticates with a fresh token and checks the broker's reply before
the connection is used; failed attempts and dropped connections are
retried with backoff. Subscriptions are held in a registry owned by the
subscribing processes, so they are made again on every reconnect and end
when the subscriber exits. Messages are delivered at QoS 0. Publishing is
QoS 0 only for now, and subscriptions aren't removed from the broker
when their last subscriber exits.

The connection sets emqtt's log level to `:info`, because at debug level
emqtt logs whole packets, including the Kerberos token in CONNECT.

## HTTP

```elixir
children = [
  {FPlus.Credentials, name: MyApp.Credentials, ...},
  {FPlus.HTTP,
   name: MyApp.HTTP,
   credentials: MyApp.Credentials,
   directory_url: "http://directory.acs.localhost"}
]

{:ok, url} = FPlus.Directory.get_service_url(MyApp.HTTP, FPlus.Service.configdb())
:ok = FPlus.CmdEsc.rebirth(MyApp.HTTP, %{group: "Site_1", node: "Edge_1"})

{:ok, %{status: 200, body: body}} =
  FPlus.HTTP.request(MyApp.HTTP, FPlus.Service.configdb(), :get, "v1/app")
```

`FPlus.HTTP.request/5` finds the service through the Directory, gets a
bearer token from the service's `/token` endpoint and makes the request
in the calling process; JSON responses are decoded. The token exchange
authenticates with Kerberos (`Negotiate`) and checks the service's
reply. Service URLs and tokens are cached, each fetched once at a time
however many callers ask, and a refused token is replaced and the
request retried once. Requests go through a Finch pool.

## Building

- **Kerberos** comes from the in-tree kerlberos fork
  (`lib/erl-kerlberos`), which Mix builds with rebar3. Install rebar3
  for Mix once with `mix local.rebar`.
- **MQTT** is emqtt. emqtt lists `quicer`, a QUIC library built from
  Microsoft's msquic with cmake, as a hard dependency, though it only
  uses it for MQTT over QUIC. `mix.exs` sets `BUILD_WITHOUT_QUIC` and
  stubs `quicer`, so building needs no cmake. Services that depend on
  this project get the same automatically.
- **Known advisory:** emqtt pulls in `cowlib` 2.21.0 and `gun` 2.7.0,
  which have CVE-2026-43966 (medium, HTTP response splitting). emqtt
  only uses them for MQTT over WebSocket, which this client doesn't
  use. There is no fixed release yet (checked 2026-10-19); update when
  there is.

## Development

```sh
mix deps.get
mix test
mix format --check-formatted
mix credo
```

Tests tagged `:acs_local` need the local test cluster, and are excluded
by default. They log in as `admin` with its password and as
`sv1warehouse` from its keytab, authenticate to the broker, and receive
the cluster's Sparkplug traffic:

```sh
umask 077
acs-local kubectl get secret krb5-keytabs -n factory-plus \
    -o jsonpath='{.data.sv1warehouse}' | base64 -d > /tmp/sv1warehouse.keytab
ACS_LOCAL_PASSWORD="$(acs-local password)" \
ACS_LOCAL_KEYTAB=/tmp/sv1warehouse.keytab \
    mix test --include acs_local
rm /tmp/sv1warehouse.keytab
```

On `acs-local` the first Kerberos login in a VM takes about 10 seconds:
kerlberos tries the KDC over UDP first, and the cluster only exposes it
over TCP. Later logins take milliseconds.
