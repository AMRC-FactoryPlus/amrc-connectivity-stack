#!/usr/bin/env python3
# ACS Gateway Depot
# Copyright 2026 University of Sheffield AMRC
# A small Ethernet switch for the VM tests.
#
# With VM_NET=shared, test/vm.sh puts two VMs and QEMU's built-in router
# on one network. They cannot simply share a hub, because the router
# answers every connection it sees, including ones between the two VMs,
# and resets them. A switch learns which port each address is on and
# sends a frame only there, the way a real network switch does.
#
#   test/switch.py <directory> <port name> [<port name> ...]
#
# Each port is a pair of Unix datagram sockets in the directory: the
# switch listens on sw-<name>.sock and sends to <name>.sock, which QEMU
# listens on. One datagram is one Ethernet frame.

import os
import selectors
import socket
import sys

directory, names = sys.argv[1], sys.argv[2:]
sel = selectors.DefaultSelector()
ports = {}
for name in names:
    path = os.path.join(directory, f"sw-{name}.sock")
    if os.path.exists(path):
        os.unlink(path)
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    sock.bind(path)
    sock.setblocking(False)
    ports[name] = sock
    sel.register(sock, selectors.EVENT_READ, name)

where = {}      # MAC address -> port name


def send(name, frame):
    try:
        ports[name].sendto(frame, os.path.join(directory, f"{name}.sock"))
    except OSError:
        pass    # that VM is not running, or its queue is full


while True:
    for key, _ in sel.select():
        try:
            frame = key.fileobj.recv(65536)
        except OSError:
            continue
        if len(frame) < 14:
            continue
        dst, src = frame[0:6], frame[6:12]
        where[src] = key.data
        # A group or broadcast address, or one not seen yet, goes everywhere.
        if dst[0] & 1 or dst not in where:
            for name in names:
                if name != key.data:
                    send(name, frame)
        elif where[dst] != key.data:
            send(where[dst], frame)
