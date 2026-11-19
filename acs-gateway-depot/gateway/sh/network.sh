# shellcheck shell=bash
# ACS Gateway Depot
# Copyright 2026 University of Sheffield AMRC
#
# Works out which port is which, then sets the hostname and the network
# configuration. Sourced by configure.sh. Sets ENN (northbound port) and
# ENS (southbound port, empty if there is none).

need_root

# The northbound port is the one that can reach Factory+. With
# NORTH_PROBE_URL set we probe for that, which is more reliable than
# looking for a default route, because a machine network with its own
# DHCP server hands out a default route as well. Without it we take the
# port that carries the default route.
find_north_port () {
    local name tries
    if [ -z "$NORTH_PROBE_URL" ]; then
        for tries in $(seq 1 24); do
            name="$(ip -4 route show default | awk '{for (i = 1; i < NF; i++) if ($i == "dev") print $(i + 1)}' | head -n 1)"
            if [ -n "$name" ] && wired_ports | grep -qx "$name"; then
                echo "$name"
                return 0
            fi
            sleep 5
        done
        return 1
    fi
    for tries in $(seq 1 24); do
        for name in $(wired_ports); do
            [ -n "$(port_ipv4 "$name")" ] || continue
            if curl -s -o /dev/null -m 5 --interface "$name" "$NORTH_PROBE_URL"; then
                echo "$name"
                return 0
            fi
        done
        [ "$tries" = 1 ] && echo "Waiting for a port that can reach $NORTH_PROBE_URL ..." >&2
        sleep 5
    done
    return 1
}

if [ "$NORTH_IF" = auto ]; then
    log "Looking for the northbound port"
    ENN="$(find_north_port)" || die "Cannot find the northbound port. Plug it in, or set NORTH_IF."
else
    ENN="$(resolve_port "$NORTH_IF")" || die "NORTH_IF=$NORTH_IF is not a port on this gateway."
fi

case "$SOUTH_IF" in
    none)
        ENS=
        ;;
    auto)
        others="$(wired_ports | grep -vx "$ENN" || true)"
        case "$(echo "$others" | grep -c . || true)" in
            0) ENS= ;;
            1) ENS="$others" ;;
            *) die "More than one spare wired port ($(echo $others)). Set SOUTH_IF to the southbound port." ;;
        esac
        ;;
    *)
        ENS="$(resolve_port "$SOUTH_IF")" || die "SOUTH_IF=$SOUTH_IF is not a port on this gateway."
        ;;
esac
[ "$ENS" != "$ENN" ] || die "The northbound and southbound ports are the same port ($ENN)."

if [ -n "$ENS" ] && [ -z "$SOUTH_ADDR" ]; then
    die "The southbound port $ENS needs SOUTH_ADDR (an address such as 192.168.1.200/24, or dhcp)."
fi
if [ -n "$ENS" ] && [ "$SOUTH_ADDR" != dhcp ] && ! [[ "$SOUTH_ADDR" =~ ^[0-9]+(\.[0-9]+){3}/[0-9]+$ ]]; then
    die "SOUTH_ADDR=$SOUTH_ADDR is not address/prefix (for example 192.168.1.200/24) or dhcp."
fi

# Changing the network under an SSH session on the wrong port cuts it off.
if [ -n "${SSH_CONNECTION:-}" ]; then
    ssh_local_ip="$(echo "$SSH_CONNECTION" | awk '{print $3}')"
    north_ip="$(port_ipv4 "$ENN" | cut -d/ -f1)"
    [ "$ssh_local_ip" = "$north_ip" ] \
        || die "You are connected by SSH through a port that is not the northbound port ($ENN). Connect through $ENN and run this again."
fi

log "Northbound port: $ENN ($(port_mac "$ENN"))"
log "Southbound port: ${ENS:-none}${ENS:+ ($(port_mac "$ENS"), $SOUTH_ADDR)}"

# Hostname. Some boards report a placeholder instead of a serial number,
# so fall back to the northbound MAC address.
if [ -z "$GW_HOSTNAME" ]; then
    serial="$(dmidecode -s system-serial-number 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9' || true)"
    case "$serial" in
        ""|0|none|na|notspecified|defaultstring|tobefilledbyoem|systemserialnumber|notapplicable)
            serial="$(port_mac "$ENN" | tr -d ':')"
            ;;
    esac
    GW_HOSTNAME="${HOSTNAME_PREFIX}-${serial}"
fi
if [ "$(hostname)" != "$GW_HOSTNAME" ]; then
    if [ -e /etc/rancher/k3s/k3s.yaml ]; then
        warn "K3s is already installed as $(hostname), so the hostname stays as it is."
    else
        log "Setting the hostname to $GW_HOSTNAME"
        hostnamectl set-hostname "$GW_HOSTNAME"
        sed -i "/^127\.0\.1\.1[[:space:]]/d" /etc/hosts
        echo "127.0.1.1 $GW_HOSTNAME" >> /etc/hosts
    fi
fi

# The Ubuntu installer leaves cloud-init in charge of the network. It
# rewrites /etc/netplan/50-cloud-init.yaml on every boot from the ports it
# saw at install time, which puts DHCP (and a default route) back on the
# southbound port. Take the network away from cloud-init for good.
mkdir -p /etc/cloud/cloud.cfg.d
echo 'network: {config: disabled}' > /etc/cloud/cloud.cfg.d/99-fplus-gw-disable-network.cfg
rm -f /etc/cloud/cloud.cfg.d/90-installer-network.cfg

netplan_new="$(mktemp)"
{
    cat <<NETPLAN
# Written by fplus-gw-configure. Edit $GW_CONF and run start.sh again
# instead of changing this file.
network:
  version: 2
  renderer: networkd
  ethernets:
    $ENN:
      dhcp4: true
      critical: true
NETPLAN
    if [ -n "$ENS" ] && [ "$SOUTH_ADDR" = dhcp ]; then
        cat <<NETPLAN
    $ENS:
      optional: true
      dhcp4: true
      dhcp4-overrides:
        use-routes: false
        use-dns: false
        use-ntp: false
        use-domains: false
      dhcp6: false
      accept-ra: false
NETPLAN
    elif [ -n "$ENS" ]; then
        cat <<NETPLAN
    $ENS:
      optional: true
      dhcp4: false
      dhcp6: false
      accept-ra: false
      addresses:
        - $SOUTH_ADDR
NETPLAN
    fi
} > "$netplan_new"

if ! cmp -s "$netplan_new" /etc/netplan/60-fplus-gw.yaml \
        || [ "$(find /etc/netplan -maxdepth 1 -name '*.yaml' | wc -l)" != 1 ]; then
    backup="$GW_BACKUP/netplan-$(date +%Y%m%dT%H%M%S)"
    cp -a /etc/netplan "$backup"
    log "Writing the network configuration (old one saved in $backup)"
    rm -f /etc/netplan/*.yaml
    install -m 600 "$netplan_new" /etc/netplan/60-fplus-gw.yaml
    netplan apply
    log "Waiting for the northbound port to come back"
    for _ in $(seq 1 30); do
        [ -n "$(port_ipv4 "$ENN")" ] && break
        sleep 2
    done
    [ -n "$(port_ipv4 "$ENN")" ] || die "The northbound port $ENN has no address after the network change."
else
    log "Network configuration is already up to date"
fi
rm -f "$netplan_new"

# The southbound port must never carry a default route.
if [ -n "$ENS" ] && ip -4 route show default dev "$ENS" 2>/dev/null | grep -q .; then
    die "The southbound port $ENS has a default route. This must not happen."
fi

cat > "$GW_STATE/ports" <<STATE
ENN=$ENN
ENS=$ENS
STATE
