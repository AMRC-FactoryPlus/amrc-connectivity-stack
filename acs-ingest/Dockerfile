# syntax=docker/dockerfile:1
# The line above must be the first line in the file!

ARG base_version
ARG base_prefix=ghcr.io/amrc-factoryplus/acs-base

ARG acs_build=${base_prefix}-ex-build:${base_version}
ARG acs_run=${base_prefix}-ex-run:${base_version}

FROM ${acs_build} AS build
ENV MIX_ENV=prod

# The path dependencies are at ../lib, as in the repo.
COPY --chown=elixir --from=lib ex-sparkplug /home/elixir/src/lib/ex-sparkplug/
COPY --chown=elixir --from=lib ex-service-client /home/elixir/src/lib/ex-service-client/
COPY --chown=elixir --from=lib erl-kerlberos /home/elixir/src/lib/erl-kerlberos/
WORKDIR /home/elixir/src/acs-ingest
COPY --chown=elixir mix.exs mix.lock ./
COPY --chown=elixir config config/
RUN <<'SHELL'
    set -e
    # A local build copies whatever the libraries' checkouts hold.
    rm -rf ../lib/*/_build ../lib/*/deps ../lib/*/tmp
    mix deps.get --only prod
    mix deps.compile
SHELL
COPY --chown=elixir lib lib/
RUN mix release

FROM ${acs_run}
WORKDIR /home/elixir/app
# The release is owned by root, i.e. read-only to the running service.
COPY --chown=root:root --from=build /home/elixir/src/acs-ingest/_build/prod/rel/acs_ingest ./
# No Erlang distribution: nothing connects to the node, so it opens no
# port. The release writes its temporary files to /tmp. A crash dump
# would be lost with the container, so the VM doesn't write one.
ENV RELEASE_DISTRIBUTION=none RELEASE_TMP=/tmp ERL_CRASH_DUMP_BYTES=0
USER elixir
CMD [ "bin/acs_ingest", "start" ]
