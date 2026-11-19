#!/bin/bash
# ACS Gateway Depot
# Runs a depot stick in a QEMU virtual machine.
# Copyright 2026 University of Sheffield AMRC
#
# Runs a depot stick in a QEMU virtual machine with two network
# ports, the way a real gateway has them:
#   port 1 (northbound):    QEMU user network with internet access
#   port 2 (southbound): an isolated network, 192.168.1.0/24, with DHCP
#
#   test/vm.sh install <image.iso> [amd64|arm64]   boot the image, install, power off
#   test/vm.sh start [amd64|arm64]                 boot the installed disk in the background
#   test/vm.sh ssh [amd64|arm64] [command]         log in
#   test/vm.sh stop [amd64|arm64]                  power the VM off
#
# On an Apple Silicon Mac arm64 runs at full speed and amd64 is emulated,
# which is several times slower. SSH, the Kubernetes API and the kubelet
# are forwarded to ports on this machine (the firewall should block the
# kubelet one).

set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
vm="$root/out/vm"
mkdir -p "$vm"
share="$(dirname "$(dirname "$(command -v qemu-img)")")/share/qemu"

# Each architecture gets its own forwarded ports, so an arm64 and an amd64
# VM can run at the same time: arm64 uses 2222, 16443 and 10250, and
# amd64 uses 2322, 16543 and 10350.
ports_for () {
    if [ "$1" = arm64 ]; then echo "2222 16443 10250"; else echo "2322 16543 10350"; fi
}

# Networking.
#
# Normally each VM has its own private northbound network, with internet
# access through QEMU. That is enough for everything except one gateway
# joining another's cluster, because the two cannot reach each other.
#
# With VM_NET=shared the two VMs share one northbound network. They and
# QEMU's router (which hands out addresses and gives internet access)
# plug into test/switch.py, a small switch this script starts. The amd64
# VM hosts the router. The router hands out addresses in the order VMs
# ask, so start the amd64 VM first and wait until it is up before
# starting the arm64 one. The amd64 VM then gets 10.0.2.15 and the arm64
# VM gets 10.0.2.16. Start them the other way round and they swap
# addresses, which breaks a cluster that has already been created.
#
# Set VM_SERIAL to give a VM a different serial number, and so a
# different hostname.
net="$vm/net"

# A port on the switch, as QEMU options: port <netdev id> <port name>
port () {
    rm -f "$net/$2.sock"
    echo "dgram,id=$1,local.type=unix,local.path=$net/$2.sock,remote.type=unix,remote.path=$net/sw-$2.sock"
}

start_switch () {
    mkdir -p "$net"
    if [ -f "$net/pid" ] && kill -0 "$(cat "$net/pid")" 2>/dev/null; then return; fi
    nohup python3 "$root/test/switch.py" "$net" amd64 arm64 router >"$net/switch.log" 2>&1 &
    echo $! > "$net/pid"
    sleep 1
}

qemu () {
    local arch="$1"; shift
    local p; read -r -a p <<< "$(ports_for "$arch")"
    local q; read -r -a q <<< "$(ports_for arm64)"
    local south=(
        -netdev "user,id=s0,restrict=on,net=192.168.1.0/24,dhcpstart=192.168.1.50"
        -device "virtio-net-pci,netdev=s0,mac=52:54:00:aa:00:02"
    )
    local fwd="hostfwd=tcp:127.0.0.1:${p[0]}-:22,hostfwd=tcp:127.0.0.1:${p[1]}-:6443,hostfwd=tcp:127.0.0.1:${p[2]}-:10250"
    local nets
    if [ "${VM_NET:-}" = shared ] && [ "$arch" = amd64 ]; then
        start_switch
        fwd="$fwd,hostfwd=tcp:127.0.0.1:${q[0]}-10.0.2.16:22,hostfwd=tcp:127.0.0.1:${q[1]}-10.0.2.16:6443"
        nets=(
            -netdev "$(port n0 amd64)"
            -device "virtio-net-pci,netdev=n0,mac=52:54:00:aa:00:01"
            # The router, wired to its own port on the switch.
            -netdev "user,id=u0,$fwd" -netdev "hubport,id=h1,hubid=0,netdev=u0"
            -netdev "$(port k0 router)" -netdev "hubport,id=h2,hubid=0,netdev=k0"
            "${south[@]}"
        )
    elif [ "${VM_NET:-}" = shared ]; then
        start_switch
        nets=(
            -netdev "$(port n0 arm64)"
            -device "virtio-net-pci,netdev=n0,mac=52:54:00:aa:00:03"
            "${south[@]}"
        )
    else
        nets=(
            -netdev "user,id=n0,$fwd"
            -device "virtio-net-pci,netdev=n0,mac=52:54:00:aa:00:01"
            "${south[@]}"
        )
    fi
    if [ "$arch" = arm64 ]; then
        [ -f "$vm/vars-arm64.fd" ] || dd if=/dev/zero of="$vm/vars-arm64.fd" bs=1m count=64 2>/dev/null
        local accel=tcg cpu=max
        [ "$(uname -m)" = arm64 ] && accel=hvf cpu=host
        qemu-system-aarch64 -M virt -accel "$accel" -cpu "$cpu" -smp 4 -m 4096 \
            -drive "if=pflash,format=raw,readonly=on,file=$share/edk2-aarch64-code.fd" \
            -drive "if=pflash,format=raw,file=$vm/vars-arm64.fd" \
            -smbios "type=1,serial=${VM_SERIAL:-VMTEST02}" \
            -drive "if=virtio,format=qcow2,file=$vm/disk-arm64.qcow2" \
            "${nets[@]}" -display none "$@"
    else
        [ -f "$vm/vars-amd64.fd" ] || cp "$share/edk2-i386-vars.fd" "$vm/vars-amd64.fd"
        local accel=tcg,thread=multi cpu=max
        [ "$(uname -m)" = x86_64 ] && accel=hvf cpu=host
        qemu-system-x86_64 -M q35 -accel "$accel" -cpu "$cpu" -smp 8 -m 6144 \
            -drive "if=pflash,format=raw,readonly=on,file=$share/edk2-x86_64-code.fd" \
            -drive "if=pflash,format=raw,file=$vm/vars-amd64.fd" \
            -smbios "type=1,serial=${VM_SERIAL:-VMTEST01}" \
            -drive "if=virtio,format=qcow2,file=$vm/disk-amd64.qcow2" \
            "${nets[@]}" -display none "$@"
    fi
}

cmd="${1:-}"; shift || true
case "$cmd" in
    install)
        iso="$1"; arch="${2:-amd64}"
        rm -f "$vm/disk-$arch.qcow2" "$vm/vars-$arch.fd"
        qemu-img create -q -f qcow2 "$vm/disk-$arch.qcow2" 20G
        echo "Installing. The serial log is $vm/install-$arch.log"
        qemu "$arch" -serial "file:$vm/install-$arch.log" -no-reboot \
            -device virtio-scsi-pci -drive "if=none,id=cd,media=cdrom,format=raw,readonly=on,file=$iso" \
            -device scsi-cd,drive=cd,bootindex=0
        echo "The VM powered off. Install finished."
        ;;
    start)
        arch="${1:-amd64}"
        qemu "$arch" -serial "file:$vm/boot-$arch.log" -daemonize -pidfile "$vm/pid-$arch"
        echo "Started. The serial log is $vm/boot-$arch.log"
        ;;
    ssh)
        arch=amd64
        case "${1:-}" in amd64|arm64) arch="$1"; shift ;; esac
        read -r -a p <<< "$(ports_for "$arch")"
        exec ssh -p "${p[0]}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
            -o LogLevel=ERROR -i "$vm/id_test" fplus@127.0.0.1 "$@"
        ;;
    stop)
        arch="${1:-amd64}"
        [ -f "$vm/pid-$arch" ] && kill "$(cat "$vm/pid-$arch")" 2>/dev/null || true
        rm -f "$vm/pid-$arch"
        ;;
    *)
        sed -n '3,18p' "$0" | sed 's/^# \{0,1\}//'
        exit 1
        ;;
esac
