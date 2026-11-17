# syntax=docker/dockerfile:1
#
# Dockerfile for a Rust split driver built on lib/rs-edge-driver.
#
# Copy this file and the .dockerignore beside it into the driver's
# directory unchanged. It expects:
#
#   - the build context to be the driver's directory, with
#     Cargo.toml, Cargo.lock and src/ in it;
#   - a second build context called `lib` pointing at the repo's lib/
#     directory, which publish.yml and mk/acs.docker.mk both pass;
#   - Cargo.toml to depend on the library by the path
#     "../lib/rs-edge-driver" and to name its binary `driver`.
#
# See docs/development/rust-drivers.md for the whole process.

# Keep this in step with RUSTUP_TOOLCHAIN in .github/workflows/rust.yaml,
# so that CI checks the code with the compiler that builds the image.
ARG rust_version=1.99

FROM rust:${rust_version}-slim-trixie AS build

# The library sits at /src/lib/rs-edge-driver and the driver at
# /src/driver, so the driver's "../lib/rs-edge-driver" path dependency
# resolves the same way here as it does in the repo. Only the parts
# cargo reads are copied, so a local target/ directory in the library
# is not sent into the build.
COPY --from=lib rs-edge-driver/Cargo.toml /src/lib/rs-edge-driver/
COPY --from=lib rs-edge-driver/src /src/lib/rs-edge-driver/src
COPY --from=lib rs-edge-driver/examples /src/lib/rs-edge-driver/examples
WORKDIR /src/driver

# Build the dependencies, and the library, against a stub main.rs
# first. This layer only changes when Cargo.toml, Cargo.lock or the
# library change, so editing the driver's own code does not rebuild
# every crate.
COPY Cargo.toml Cargo.lock ./
RUN <<'SHELL'
    set -e
    mkdir src
    echo 'fn main() {}' > src/main.rs
    cargo build --release --locked
    rm -rf src
SHELL

COPY src ./src
# Declare this late: changing an ARG reruns every RUN after it.
# The driver can read it with option_env!("GIT_VERSION").
ARG revision=unknown
RUN <<'SHELL'
    set -e
    # COPY keeps the files' old timestamps, which can look older than
    # the stub build above. Touching main.rs makes cargo rebuild the
    # driver crate instead of reusing the stub binary.
    touch src/main.rs
    GIT_VERSION="${revision}" cargo build --release --locked
    install -D target/release/driver /out/driver
SHELL

# distroless/cc has glibc, libgcc and CA certificates and nothing else.
# The debug variant adds a busybox shell, which the edge-agent chart
# needs: every driver container has a startup probe that runs
# `sh -c true` (edge-agent/templates/_backoff-prevention.tpl). The
# nonroot variant runs as uid 65532.
FROM gcr.io/distroless/cc-debian13:debug-nonroot AS run
COPY --from=build /out/driver /usr/local/bin/driver
USER nonroot
ENTRYPOINT ["/usr/local/bin/driver"]
