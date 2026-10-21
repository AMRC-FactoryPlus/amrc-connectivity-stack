# ACS Ingest

One Elixir application to replace ACS's Node.js ingestion services. It
runs them as parts that share one Factory+ client: the Sparkplug
historian first, and later the UNS ingester and the UNS historian.

## Status

The Sparkplug historian is written, but not yet tested against a real
InfluxDB, built into an image or deployed. The application reads its
configuration, and starts the Factory+ client
(`lib/ex-service-client`), a buffered InfluxDB writer for the
historian (`Ingest.Writer`), and the Sparkplug path
(`Ingest.Sparkplug`). That keeps each edge node's births, asks unknown
devices to rebirth, and resolves their data, which the historian
(`Ingest.SparkplugHistorian`) turns into the points the JS historian
wrote, apart from the cases where those were wrong.

## Configuration

The configuration comes from the environment, using the variables the
JS historian and ACS's Helm chart use. `Ingest.Config`
(`lib/ingest/config.ex`) documents each one. The Sparkplug historian
needs at least:

- `DIRECTORY_URL`, `CLIENT_KEYTAB` and `KRB5_CONFIG`
- `SPARKPLUG_HISTORIAN=true`
- `INFLUX_URL`, `INFLUX_ORG` and `INFLUX_TOKEN`

If the configuration is missing or invalid, the application doesn't
start, and logs which variable is wrong.

## Development

```sh
mix deps.get
mix test
mix format --check-formatted
mix credo
```

The application reads its configuration when it starts, so `mix test`
doesn't start it (see `mix.exs`); tests start what they need.

### On acs-local

Tests tagged `:acs_local` need the local test cluster, and are excluded
by default. They log in as `sv1warehouse` from its keytab:

```sh
umask 077
acs-local kubectl get secret krb5-keytabs -n factory-plus \
    -o jsonpath='{.data.sv1warehouse}' | base64 -d > /tmp/sv1warehouse.keytab
ACS_LOCAL_KEYTAB=/tmp/sv1warehouse.keytab mix test --include acs_local
```

To run the application itself, give it a `krb5.conf` that points the
`ACS.LOCALHOST` realm at `kdc = 127.0.0.1:88`, and the environment:

```sh
KRB5_CONFIG=/tmp/krb5.conf \
DIRECTORY_URL=http://directory.acs.localhost/ \
CLIENT_KEYTAB=/tmp/sv1warehouse.keytab \
SPARKPLUG_HISTORIAN=true \
INFLUX_URL=http://influxdb.acs.localhost INFLUX_ORG=default INFLUX_TOKEN=... \
    mix run --no-halt
```

Delete the keytab afterwards. The first Kerberos login in a VM takes
about 10 seconds, as kerlberos tries the KDC over UDP first and the
cluster only exposes it over TCP.
