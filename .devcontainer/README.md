# Dev container

This gives you a ready-to-use environment for working on ACS: Node/TS,
Python, Rust (`lib/rs-edge-driver`), and Java/Maven (`lib/java-service-client`),
plus Docker, `kubectl`, and `helm`.

## Getting started

1. Open the repo in VS Code and run **Dev Containers: Reopen in
   Container**, or, from the CLI:
   ```sh
   devcontainer up --workspace-folder .
   ```
2. First build runs `onCreateCommand`, which installs Kerberos headers,
   build tools, and a JDK/Maven via `apt-get`. Run `npm install` in `lib/`
   yourself afterwards - other subdirs depend on it per the top-level
   `Makefile`. Each individual service still needs its own `npm install`
   before you work on it - the container doesn't bootstrap every service.
3. Optional: set up kubeconfig access (see below) if you want
   `kubectl`/`helm` in the container to reach your existing clusters.

## Kubeconfig access (optional)

By default `kubectl`/`helm` in the container have no cluster contexts -
the kubeconfig mount falls back to a harmless no-op (`/dev/null`) when
unconfigured, so the container builds and works fine without it. To opt
in, copy the template and point it at a kubeconfig file on your host:

```sh
cp .devcontainer/devcontainer.env.example .devcontainer/devcontainer.env
# then edit KUBE_HOST_DIR in that file
```

`devcontainer.env` is gitignored - it's machine-specific. `KUBE_HOST_DIR`
is the absolute path to a single kubeconfig yaml file - your real
`~/.kube/config`, or a separate file containing just the contexts you
want available in the container, if `~/.kube/config` has contexts you'd
rather not share. It's bind-mounted to `/home/node/.kube/config`.

Notes:
- `KUBE_HOST_DIR` must point at a file, not a directory. If you need to
  merge multiple kubeconfig files, do that on the host first (e.g.
  `KUBECONFIG=a:b kubectl config view --flatten > merged`) and point
  `KUBE_HOST_DIR` at the merged result.
- Contexts that rely on a cloud auth plugin (`gcloud`, `aws`, `az`, etc.)
  need that CLI installed in the container too - the mount only shares
  the config file, not the plugin binaries.
- `devcontainer.json` can't dynamically fall back to "your real
  `~/.kube/config`" when `KUBE_HOST_DIR` is unset - variable substitution
  doesn't support nesting another variable inside a default value. That's
  why the unconfigured state is a fixed `/dev/null` no-op rather than any
  real kubeconfig file.

## Forwarded ports

`3000` (common Node service API default) and `5173` (`acs-admin`'s Vite
dev server) are forwarded automatically. Add others as needed for
whatever service you're running.

## Building component images / using Docker

The `docker-in-docker` feature gives you a working `docker` CLI so you
can `docker build` and run `make` targets in this repo that shell out to
Docker.
