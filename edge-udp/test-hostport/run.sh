#!/bin/sh
# ACS edge-udp
# Check a datagram sent to the node reaches the driver through a hostPort
# Copyright 2026 University of Sheffield
#
# This copies, in one privileged container, the network arrangement a
# hostPort gives on a k3s node: the pod in its own network namespace
# behind a veth, and the CNI portmap plugin's DNAT rule sending the
# node's port to the pod's. A "robot" namespace on a separate network
# sends datagrams to the node's address. The real driver runs in the
# pod namespace beside a broker standing in for the Edge Agent.
#
# Run from the repository root, after building the driver:
#
#   docker run --rm -v "$PWD":/w -w /w/edge-udp rust:1.99 cargo build --release
#   docker run --rm --privileged -v "$PWD/edge-udp":/w debian:trixie /w/test-hostport/run.sh
#
# COUNT (default 2000) datagrams are sent at RATE (default 10000) a
# second. It checks that every datagram arrives, that the driver sees the
# robot's own address as the source, and that without the DNAT rule
# nothing arrives.

set -eu

echo "net.core.rmem_max here: $(cat /proc/sys/net/core/rmem_max)"

COUNT=${COUNT:-2000}
RATE=${RATE:-10000}
PORT=5000
NODE_IP=192.0.2.1
ROBOT_IP=192.0.2.50
POD_IP=10.42.0.10

apt-get update -qq >/dev/null
apt-get install -y -qq iproute2 iptables mosquitto mosquitto-clients \
    python3 tcpdump >/dev/null 2>&1

# The pod: its own namespace, routed through the node.
ip netns add pod
ip link add veth-pod type veth peer name eth0 netns pod
ip addr add 10.42.0.1/24 dev veth-pod
ip link set veth-pod up
ip netns exec pod ip addr add $POD_IP/24 dev eth0
ip netns exec pod ip link set eth0 up
ip netns exec pod ip link set lo up
ip netns exec pod ip route add default via 10.42.0.1

# The robot: on the plant network, which reaches the node only.
ip netns add robot
ip link add veth-plant type veth peer name eth0 netns robot
ip addr add $NODE_IP/24 dev veth-plant
ip link set veth-plant up
ip netns exec robot ip addr add $ROBOT_IP/24 dev eth0
ip netns exec robot ip link set eth0 up

echo 1 >/proc/sys/net/ipv4/ip_forward

# The Edge Agent's broker and the driver, in the pod.
cat >/tmp/mosquitto.conf <<EOF
listener 1883 127.0.0.1
allow_anonymous true
EOF
ip netns exec pod mosquitto -c /tmp/mosquitto.conf -d
sleep 1
ip netns exec pod sh -c 'mosquitto_sub -h 127.0.0.1 -t "fpEdge1/robot/#" -v >/tmp/mqtt.log' &
ip netns exec pod tcpdump -i eth0 -nn -c 1 "udp port $PORT" >/tmp/tcpdump.log 2>&1 &
ip netns exec pod env EDGE_MQTT=mqtt://localhost EDGE_USERNAME=robot \
    EDGE_PASSWORD=x VERBOSE=1 /w/target/release/driver >/tmp/driver.log 2>&1 &
sleep 2

pub () { ip netns exec pod mosquitto_pub -h 127.0.0.1 -t "fpEdge1/robot/$1" -m "$2"; }
pub active ONLINE
pub conf "{\"port\": $PORT}"
sleep 1
pub addr '{"version": 1, "addrs": {"d": ""}}'
sleep 1

send () {
    ip netns exec robot python3 - "$1" "$2" "$RATE" <<'EOF'
import socket, sys, time
n, dest, rate = int(sys.argv[1]), sys.argv[2], int(sys.argv[3])
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
start = time.monotonic()
for i in range(n):
    s.sendto(b"%08d" % i, (dest, 5000))
    # Paced to RATE a second, in bursts of 100.
    if i % 100 == 99:
        ahead = start + (i + 1) / rate - time.monotonic()
        if ahead > 0:
            time.sleep(ahead)
print("sent %d in %.1f s, %d a second" % (n, time.monotonic() - start,
    n / (time.monotonic() - start)))
EOF
}
received () { grep -c "^fpEdge1/robot/data/d " /tmp/mqtt.log || true; }

fail=0

# Without the hostPort rule the node does not pass the port on.
send 50 $NODE_IP
sleep 1
got=$(received)
echo "without the DNAT rule: $got of 50 arrived"
[ "$got" = 0 ] || fail=1

# What the CNI portmap plugin adds for a hostPort.
iptables -t nat -A PREROUTING -p udp --dport $PORT \
    -j DNAT --to-destination $POD_IP:$PORT

send "$COUNT" $NODE_IP
sleep 2
got=$(received)
echo "with the DNAT rule: $got of $COUNT arrived"
[ "$got" = "$COUNT" ] || fail=1

src=$(grep -o "IP [0-9.]*" /tmp/tcpdump.log | head -1 | cut -d' ' -f2 | cut -d. -f1-4)
echo "source address seen in the pod: $src"
[ "$src" = "$ROBOT_IP" ] || fail=1

echo "first and last data messages:"
grep "^fpEdge1/robot/data/d " /tmp/mqtt.log | sed -n '1p;$p'
echo "driver status messages:"
grep "^fpEdge1/robot/status" /tmp/mqtt.log | tr '\n' ' '; echo

if [ $fail = 0 ]; then echo PASS; else echo FAIL; cat /tmp/driver.log; fi
exit $fail
