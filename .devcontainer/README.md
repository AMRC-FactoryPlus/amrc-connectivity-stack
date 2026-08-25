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
2. First build runs `onCreateCommand` (installs Kerberos headers, build
   tools, and a JDK/Maven via `apt-get`) and `postCreateCommand` (`npm
   install` in `lib/`, which other subdirs depend on per the top-level
   `Makefile`). Each individual service still needs its own `npm install`
   before you work on it - the container doesn't bootstrap every service.
3. Optional: set up kubeconfig access (see below) if you want
   `kubectl`/`helm` in the container to reach your existing clusters.

## Kubeconfig access (optional)

By default `kubectl`/`helm` in the container have no cluster contexts -
the kubeconfig mount falls back to a harmless no-op (`/tmp`) when
unconfigured, so the container builds and works fine without it. To opt
in, copy the template and point it at a kubeconfig directory on your
host:

```sh
cp .devcontainer/devcontainer.env.example .devcontainer/devcontainer.env
# then edit KUBE_HOST_DIR in that file
```

`devcontainer.env` is gitignored - it's machine-specific. `KUBE_HOST_DIR`
can point at your real `~/.kube`, or a smaller directory containing just
the kubeconfig(s) you want available in the container, if `~/.kube` has
contexts or plugin caches you'd rather not share. Whatever directory you
point at is bind-mounted to `/home/node/.kube`.

Notes:
- `kubectl`/`helm` only auto-read `/home/node/.kube/config`. If your
  directory has multiple kubeconfig files, use `--kubeconfig=...` or set
  `KUBECONFIG` to a colon-separated list to merge them.
- Contexts that rely on a cloud auth plugin (`gcloud`, `aws`, `az`, etc.)
  need that CLI installed in the container too - the mount only shares
  the config file, not the plugin binaries.
- `devcontainer.json` can't dynamically fall back to "your real `~/.kube`"
  when `KUBE_HOST_DIR` is unset - variable substitution doesn't support
  nesting another variable inside a default value. That's why the
  unconfigured state is a fixed `/tmp` no-op rather than any real
  kubeconfig directory.

## Forwarded ports

`3000` (common Node service API default) and `5173` (`acs-admin`'s Vite
dev server) are forwarded automatically. Add others as needed for
whatever service you're running.

## Building component images / using Docker

The `docker-in-docker` feature gives you a working `docker` CLI so you
can `docker build` and run `make` targets in this repo that shell out to
Docker.
