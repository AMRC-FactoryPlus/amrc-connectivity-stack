# NTP Server Helm Chart

## Overview

The NTP Server chart runs a [chrony](https://chrony-project.org) NTP
server on a specific edge host, using the
[`cturra/ntp`](https://github.com/cturra/docker-ntp) image. It is
intended for cell gateways that need to serve time to devices on their
downstream networks, which often cannot reach an NTP server of their
own.

## How it works

- The pod uses the host's network, so the server listens on UDP 123 on
  every address the host has. Clients point at the host's own IP on
  their network; no Service or external IP is needed.
- Because the server's address is the host's address, the deployment
  must be pinned to a host. Deploying without a hostname fails.
- chronyd runs with `-x`, so it never adjusts the host clock. The host
  should keep syncing its own clock as before (e.g. with
  `systemd-timesyncd`).
- The server answers any client that can reach it. If it loses all its
  upstream servers it keeps serving its own clock at stratum 10, so
  clients on an isolated network stay consistent with each other.

## Deployment

### Via ACS Admin UI

1. In `acs-admin`, navigate to an edge cluster
2. Click "New Edge Deployment"
3. Select "NTP Server" from the Chart dropdown
4. Choose the host to serve NTP from
5. Configure values (see below)
6. Click "Create"

### Values

Override any of the defaults from `values.yaml`:

```yaml
ntpServers:                            # Default: 0-2.pool.ntp.org
  - ntp1.example.com
  - ntp2.example.com
resources:
  limits:
    cpu: "100m"                        # Default: "100m"
    memory: "64Mi"                     # Default: "64Mi"
tolerations:
  specific: []                         # Host-specific tolerations
```

## Checking it works

On the host, `sudo ss -ulpn 'sport = :123'` should show `chronyd`.

From a client, query the host's IP without changing the client's clock:

```sh
# Windows
w32tm /stripchart /computer:<host IP> /samples:3 /dataonly
# Linux, with chrony installed
sudo chronyd -Q 'server <host IP> iburst'
```
