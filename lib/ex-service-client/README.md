# ACS Service Client (Elixir)

A client for Factory+ services, for Elixir services in ACS. Services use
it through a path dependency, which also brings in the Sparkplug library
and the kerlberos fork:

```elixir
{:fplus, path: "../lib/ex-service-client"}
```

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
- Next: the MQTT connection, then the HTTP layer (tokens, discovery,
  Command Escalation).

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

kerlberos doesn't read `KRB5_CONFIG`. Without the `:kdc` option it uses
`/etc/krb5.conf` and DNS, which isn't where ACS pods keep their
`krb5.conf`, so in a cluster pass `:kdc` for now.

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
`sv1warehouse` from its keytab, and authenticate to the broker:

```sh
umask 077
acs-local kubectl get secret krb5-keytabs -n factory-plus \
    -o jsonpath='{.data.sv1warehouse}' | base64 -d > /tmp/sv1warehouse.keytab
ACS_LOCAL_PASSWORD="$(acs-local password)" \
ACS_LOCAL_KEYTAB=/tmp/sv1warehouse.keytab \
    mix test --include acs_local
rm /tmp/sv1warehouse.keytab
```
