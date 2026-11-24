# Adding a Rust Driver

This page takes a new Rust split driver from an empty directory to an
image that an Edge Agent can deploy. A split driver is a small
container that runs beside the Edge Agent and talks to it over the
agent's local MQTT broker. The protocol is described in
[`acs-edge/docs/edge-split.md`](../../acs-edge/docs/edge-split.md),
and [`lib/rs-edge-driver`](../../lib/rs-edge-driver/README.md)
implements it for Rust, so a driver only has to talk to its device.

The steps below use a driver called `edge-foo` as the example. Replace
`foo` and `Foo` with your protocol's name.

## 1. The code

Make a directory `edge-foo` at the top of the repository, next to the
other `edge-*` drivers, with this layout:

```
edge-foo/
  Cargo.toml
  Cargo.lock
  src/main.rs
  Dockerfile        copied from lib/rs-edge-driver/driver-template/
  .dockerignore     copied from lib/rs-edge-driver/driver-template/
  Makefile
  README.md
```

`Cargo.toml` depends on the library by path and names its binary
`driver`, because the Dockerfile expects both:

```toml
[package]
name = "edge-foo"
version = "0.1.0"
edition = "2024"
publish = false

[[bin]]
name = "driver"
path = "src/main.rs"

[dependencies]
rs-edge-driver = { path = "../lib/rs-edge-driver" }
async-trait = "0.1"
bytes = "1"
serde_json = "1"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }

[profile.release]
strip = true
```

`serde_json` is needed because `Handler::create` receives the
connection's configuration as a `serde_json::Value`. Write the
handler as the library's README describes.

[`edge-test-rs`](../../edge-test-rs/README.md) is the reference
driver: copy its layout rather than the library's
`examples/test_driver.rs`, which is a smaller sketch and does not
match the JS test driver. In `edge-test-rs`, `main.rs` only sets up
logging and runs the driver, and the rest sits in a `src/lib.rs` crate
with one module for address parsing (with unit tests), one for the
device and one for the `Handler`. A `lib.rs` is what lets the files in
`tests/` reach the handler. Its `tests/driver.rs` runs the whole
driver against the fake Edge Agent in
`lib/rs-edge-driver/tests/common/`, loaded with a `#[path]` module,
which needs `rumqttc` and tokio's `full` features as
dev-dependencies.

Commit `Cargo.lock`. The Dockerfile and CI both build with `--locked`,
so a missing or stale lock file fails the build rather than picking
new dependency versions silently.

If the driver should report its version, read it at compile time with
`option_env!("GIT_VERSION")`. The image build sets it from the
`revision` build argument, in the same way the JS drivers get
`lib/git-version.js`.

The `Makefile` gives the driver the same `make build` as the other
services:

```make
top=..
include ${top}/mk/acs.init.mk

repo?=edge-foo

include ${mk}/acs.docker.mk
```

### Listing the device's addresses (optional)

A driver can take part in Edge Scout, which lets an operator scan the
device from the Admin UI and pick addresses instead of typing them. Set
`const SCOUTS: bool = true` on the handler and return a `Scouter` from
`Handler::scouter`. [Adding scouting to a driver](../architecture/edge-management/edge-scout-drivers.md)
explains the rules for items and has a complete example, and
[`edge-test-rs/src/scout.rs`](../../edge-test-rs/src/scout.rs) is the
smallest real scouter. A driver that leaves `SCOUTS` false answers
every scan with "This driver can't list its addresses."

Give the driver definition a `scout` key as well (step 5).

## 2. The Dockerfile

Copy `lib/rs-edge-driver/driver-template/Dockerfile` and
`.dockerignore` into the driver's directory and leave them unchanged.
What the Dockerfile does:

- It builds with the official `rust` image, then copies only the
  binary into `gcr.io/distroless/cc-debian13:debug-nonroot`, so the
  image holds glibc, CA certificates, a busybox shell and the driver,
  and runs as the non-root user 65532.
- It builds the dependencies against a stub `main.rs` first, so a
  change to the driver's own code rebuilds only the driver crate and
  not every dependency.
- It reads the library from the extra build context `lib`, which both
  `publish.yml` and `mk/acs.docker.mk` pass, so the driver's
  `../lib/rs-edge-driver` path resolves inside the build.

The shell in the runtime image is there for the edge-agent chart,
whose startup probe runs `sh -c true` in every driver container. An
image with no shell at all would never pass that probe.

To build the image locally from the top of the repository:

```bash
docker buildx build --build-context lib=lib -t edge-foo edge-foo
```

When the template changes, copy it into each driver again. The
template and every copy pin the same Rust version as the CI workflow
(see step 3).

## 3. CI

`.github/workflows/rust.yaml` runs `cargo fmt --check`,
`cargo clippy --all-targets -- -D warnings` and `cargo test` on pull
requests that touch Rust code. It finds every directory in the
repository with a `Cargo.toml` checked in, so a new driver is checked
without any change to the workflow.

The workflow pins the Rust version in `RUSTUP_TOOLCHAIN`, and the
Dockerfiles pin the same version in `rust_version`. Change both
together, so that the code CI passes is the code the images build.

A driver that replaces a built-in Edge Agent connection must also give
the same Sparkplug output as the built-in, which the golden-output
harness in `acs-edge/tests/golden` checks.
`.github/workflows/split-driver-golden.yaml` builds each such driver
and runs the harness against it. Add the driver's directory and the
protocol of the fixtures it replaces to its matrix, and the directory
to its `paths`.

## 4. Publishing the image

Images are built and pushed by `.github/workflows/publish.yml` when an
ACS release is published. Add `edge-foo` to all three service lists
for the Edge Agent and drivers: `build-arm-js-amd64`,
`build-arm-js-arm64` and `build-arm-js-merge`. The first two build the
image natively on amd64 and arm64 runners, and the merge job joins
them into one multi-arch tag, `ghcr.io/amrc-factoryplus/edge-foo:<version>`.
A driver left out of the arm64 or merge list gets only an
`-amd64` tag, which an Edge Agent will not pull by default.

The jobs have "js" in their names for historical reasons. They build
any directory with a Dockerfile, so Rust drivers use them as they are.

Driver images are versioned with ACS, so a driver change ships in the
next ACS release.

## 5. The driver definition

The Edge Agent and the Admin UI learn about a driver from its driver
definition in the ConfigDB, which service setup loads from
[`acs-service-setup/dumps/edge.yaml`](../../acs-service-setup/dumps/edge.yaml).

1. Give the driver a UUID in the `Driver` group of
   `acs-service-setup/lib/uuids.js`.
2. Add it to the `Edge.Class.Driver` list near the top of `edge.yaml`
   with a display name: `!u ACS.Driver.Foo: { name: "Foo" }`.
3. Add its definition under the `Edge.App.DriverDef` configs, with
   `polled`, the `presentation` text for the address and path fields,
   `image.repository: edge-foo` and a JSON `schema` for the
   connection details. The Modbus entry is a good model, and the
   comment at the top of the configs section lists every field.
4. If the driver scans, add a `scout` key with a `title`, an
   `address_form` and an `options` schema listing only the options the
   scouter reads. If it never will, `scout: false` hides the Addresses
   panel. See
   [the driver definition](../architecture/edge-management/edge-scout-drivers.md#the-driver-definition).

Set `hidden: true` until the image has been published in a release,
so the Admin UI does not offer a driver whose image does not exist yet.

## 6. An image alias in the chart (optional)

[`edge-helm-charts/charts/edge-agent/values.yaml`](../../edge-helm-charts/charts/edge-agent/values.yaml)
has a list of short image names under `image`, such as `modbus` for
`edge-modbus`. A connection deployed by hand through the chart's
`drivers` value can use the short name. Connections made in the Admin
UI use the driver definition's `image` instead, so this step is only
needed if people will write chart values by hand:

```yaml
image:
  foo:
    repository: edge-foo
```

## Using the library from outside this repository

Drivers in this repository depend on `lib/rs-edge-driver` by path, as
above, so they always build against the library in the same commit.

A driver kept in another repository depends on it by git. Pin a
release tag, not a branch, so the driver only changes when you choose
to move it:

```toml
rs-edge-driver = { git = "https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack", tag = "rs/edge-driver/v0.1.0" }
```

Cargo finds the crate in `lib/rs-edge-driver` by its name, so no path
is needed.

Library releases are tagged `rs/edge-driver/vX.Y.Z`, after the
`js/edge-driver/vX.Y.Z` tags of the JS library, where `X.Y.Z` is the
`version` in the library's `Cargo.toml`. To make one:

1. Bump `version` in `lib/rs-edge-driver/Cargo.toml` in a pull
   request. While the version is below 1.0, bump the minor version for
   a change that breaks existing drivers and the patch version for
   anything else.
2. Once it is merged into `dev`, tag that merge commit
   `rs/edge-driver/vX.Y.Z` and push the tag.

Nothing is published to crates.io, and `release.yaml` does nothing for
an `rs/` tag, so a GitHub release for it is optional.
