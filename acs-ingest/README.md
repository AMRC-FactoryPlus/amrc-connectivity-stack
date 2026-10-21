# ACS Ingest

One Elixir application to replace ACS's Node.js ingestion services. It
runs them as parts in one pod: the Sparkplug historian first, and later
the UNS ingester and the UNS historian. Each part has its own Factory+
client, logged in as its own principal, as the JS services were, and
the parts share the InfluxDB writers.

## Status

The Sparkplug historian is written, and builds into an image that runs
on `acs-local`, but isn't yet tested against a real InfluxDB or in the
Helm chart. The application reads its
configuration, and starts the Factory+ client
(`lib/ex-service-client`), a buffered InfluxDB writer for the
historian (`Ingest.Writer`), and the Sparkplug path
(`Ingest.Sparkplug`). That keeps each edge node's births, asks unknown
devices to rebirth, and resolves their data, which the historian
(`Ingest.SparkplugHistorian`) turns into the points the JS historian
wrote, apart from the cases where those were wrong.
`Ingest.StallMonitor` restarts the Factory+ client when messages stop
or its connection stays down, and stops the service if that doesn't
help.

## Configuration

The configuration comes from the environment. Variables the parts
share have plain names, and a part's own start with its name.
`Ingest.Config` (`lib/ingest/config.ex`) documents each one. The
Sparkplug historian needs at least:

- `DIRECTORY_URL` and `KRB5_CONFIG`
- `SPARKPLUG_HISTORIAN=true` and `SPARKPLUG_HISTORIAN_KEYTAB`
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
SPARKPLUG_HISTORIAN=true \
SPARKPLUG_HISTORIAN_KEYTAB=/tmp/sv1warehouse.keytab \
INFLUX_URL=http://influxdb.acs.localhost INFLUX_ORG=default INFLUX_TOKEN=... \
    mix run --no-halt
```

Delete the keytab afterwards. Put `udp_preference_limit = 1` in the
`krb5.conf`'s `[libdefaults]`, as ACS's has: otherwise kerlberos tries
the KDC over UDP first, and as the cluster only exposes it over TCP,
each login and ticket request takes about 10 seconds.

## Image

`make` builds the image and pushes it, to `ghcr.io/amrc-factoryplus`
unless `registry` is set in `config.mk` (see `mk/README.md`). It needs
the Elixir base images, built in `acs-base-images`, at the version in
`base_version`. To build it into the local Docker instead, without
pushing:

```sh
docker buildx build --load -t acs-ingest:dev \
    --build-arg base_version=v1.0.0 --build-context lib=../lib .
```

The image runs the release as the `elixir` user, with no Erlang
distribution. It reads the same environment as above; Kubernetes stops
it with SIGTERM, after which the writers write what they hold. When
the stall monitor gives up, the VM exits with status 1.
