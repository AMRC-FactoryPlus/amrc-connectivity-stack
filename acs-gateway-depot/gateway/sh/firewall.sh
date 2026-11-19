# shellcheck shell=bash
# ACS Gateway Depot
# Copyright 2026 University of Sheffield AMRC
#
# Firewall. Sourced by configure.sh after network.sh, which sets ENN and ENS.
#
# The rules live in their own nftables table, loaded by nftables.service at
# every boot before the network comes up. K3s keeps its rules in separate
# tables, so the two do not touch each other. A packet has to pass both.
#
#   Northbound port, inbound: SSH and the Kubernetes API only (plus the
#     ports cluster nodes use to reach each other, for a multi-node cluster).
#   Southbound port, inbound: open, so drivers can receive from machines.
#   Between the two ports: nothing is forwarded, in either direction. Pods
#     still reach machines, because that traffic comes from the pod network
#     and not from the northbound port.

need_root

command -v nft >/dev/null 2>&1 || {
    log "Installing nftables"
    DEBIAN_FRONTEND=noninteractive apt-get install -y nftables
}

# A single-node gateway needs nothing else. A cluster with agents needs the
# kubelet port and the WireGuard ports that flannel uses between nodes.
node_ports=
if [ "$K3S_MODE" = join ] || [ "$MULTI_NODE" = yes ]; then
    node_ports='tcp dport 10250 accept
        udp dport { 51820, 51821 } accept'
fi

forward_rules=
if [ -n "$ENS" ]; then
    forward_rules="iifname \"$ENN\" oifname \"$ENS\" drop
        iifname \"$ENS\" oifname \"$ENN\" drop"
fi

log "Writing the firewall rules"
[ -f /etc/nftables.conf ] && [ ! -f "$GW_BACKUP/nftables.conf.orig" ] \
    && cp -a /etc/nftables.conf "$GW_BACKUP/nftables.conf.orig"

cat > /etc/nftables.conf <<NFT
#!/usr/sbin/nft -f
# Written by fplus-gw-configure. Run start.sh again instead of editing.
#
# Do not add "flush ruleset" here. It would delete the K3s rules as well.

table inet fplus_gw
delete table inet fplus_gw

table inet fplus_gw {
    chain input {
        type filter hook input priority filter - 10; policy accept;

        iifname != "$ENN" accept
        ct state established,related accept
        ct state invalid drop
        meta l4proto { icmp, ipv6-icmp } accept
        udp dport 68 accept
        tcp dport { 22, 6443 } accept
        $node_ports
        drop
    }

    chain forward {
        type filter hook forward priority filter - 10; policy accept;

        $forward_rules
    }
}
NFT
chmod 755 /etc/nftables.conf

nft -c -f /etc/nftables.conf || die "The firewall rules did not pass the nftables check."
nft -f /etc/nftables.conf
systemctl enable nftables.service >/dev/null 2>&1
