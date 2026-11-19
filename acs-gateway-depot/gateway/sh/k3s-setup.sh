# shellcheck shell=bash
# ACS Gateway Depot
# Copyright 2026 University of Sheffield AMRC
#
# Installs K3s and creates or joins the cluster. Sourced by configure.sh.
#
# The K3s version is pinned in versions.env. The binary comes from
# payload/ if the install media carried one (the shop floor network may
# not reach GitHub), and is downloaded otherwise. Either way its checksum
# must match versions.env.

need_root
# shellcheck disable=SC1091
. "$GW_ROOT/versions.env"

arch="$(machine_arch)"
sha_var="K3S_SHA256_${arch}"
k3s_sha="${!sha_var}"

if [ -n "$REGISTRY_MIRROR" ]; then
    log "Pointing K3s at the container mirror $REGISTRY_MIRROR"
    mkdir -p /etc/rancher/k3s
    cat > /etc/rancher/k3s/registries.yaml <<REGISTRIES
mirrors:
  docker.io:
    endpoint:
      - "$REGISTRY_MIRROR"
    rewrite:
      "(.*)": "docker.io/\$1"
  ghcr.io:
    endpoint:
      - "$REGISTRY_MIRROR"
    rewrite:
      "(.*)": "ghcr.io/\$1"
REGISTRIES
fi

installed="$(/usr/local/bin/k3s --version 2>/dev/null | awk 'NR==1 {print $3}' || true)"

if [ -n "$installed" ] && [ "$installed" != "$K3S_VERSION" ]; then
    # Kubernetes only supports moving up one minor version at a time, so an
    # old gateway cannot jump straight to the pinned version.
    warn "K3s $installed is already installed and this script pins $K3S_VERSION."
    warn "This script does not change K3s. Upgrade it one minor version at a time, or reinstall the gateway."
elif [ -n "$installed" ] && systemctl is-active --quiet k3s k3s-agent 2>/dev/null; then
    log "K3s $installed is already installed and running"
else
    k3s_tmp="$(mktemp)"
    if [ -f "$GW_ROOT/payload/k3s-$arch" ]; then
        log "Using the K3s $K3S_VERSION binary from the install media"
        cp "$GW_ROOT/payload/k3s-$arch" "$k3s_tmp"
    else
        asset=k3s
        [ "$arch" = arm64 ] && asset=k3s-arm64
        log "Downloading K3s $K3S_VERSION"
        curl -fsSL -o "$k3s_tmp" \
            "https://github.com/k3s-io/k3s/releases/download/${K3S_VERSION//+/%2B}/$asset" \
            || die "Could not download K3s. If this network cannot reach GitHub, run stick/fetch.sh on a machine that can and copy payload/ here."
    fi
    echo "$k3s_sha  $k3s_tmp" | sha256sum -c --quiet || die "The K3s binary does not match the checksum in versions.env."
    install -m 755 "$k3s_tmp" /usr/local/bin/k3s
    rm -f "$k3s_tmp"

    if [ "$K3S_MODE" = create ]; then
        log "Creating a K3s cluster"
        cat > /etc/rancher/k3s/config.yaml <<'CONFIG'
# Written by fplus-gw-configure.
cluster-init: true
disable:
  - traefik
flannel-backend: wireguard-native
write-kubeconfig-mode: "0644"
CONFIG
        INSTALL_K3S_SKIP_DOWNLOAD=true sh "$GW_ROOT/sh/k3s.sh" server
    else
        log "Joining the K3s cluster at $K3S_URL"
        INSTALL_K3S_SKIP_DOWNLOAD=true K3S_URL="$K3S_URL" K3S_TOKEN="$K3S_TOKEN" \
            sh "$GW_ROOT/sh/k3s.sh" agent
    fi
fi

if [ "$K3S_MODE" = create ] && [ -x /usr/local/bin/k3s ]; then
    log "Waiting for the node to be ready"
    for _ in $(seq 1 60); do
        k3s kubectl get nodes 2>/dev/null | grep -q ' Ready ' && break
        sleep 5
    done
    k3s kubectl get nodes 2>/dev/null | grep -q ' Ready ' || die "K3s is installed but the node did not become ready in 5 minutes. See: journalctl -u k3s"
fi
