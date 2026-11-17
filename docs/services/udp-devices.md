# Connecting a UDP device

This page is for whoever connects a device that sends UDP datagrams to
an Edge Agent, such as a robot streaming its position, when the device
sits on the plant network outside the edge cluster. It covers where the
device must send, what the network must allow, and how to set up the
edge host for high rates.

It applies to connections that use the UDP split driver (`edge-udp`,
named "UDP (split driver)" in the Manager's driver list). The older built-in UDP
connection runs inside the Edge Agent container and cannot be reached
from outside the cluster.

## Where the device sends

The device sends to the **IP address of the edge host the Edge Agent
runs on**, on the **port set on the connection**.

When you save a UDP split driver connection with a port, the Manager
writes the port into the Edge Agent's deployment, and the driver's
container opens that port on its host (a Kubernetes `hostPort`). A
datagram sent to the host's address on that port goes straight to the
driver, and the driver sees the device's own address as the sender.
Nothing needs editing by hand, and if you change the port on the
connection, the open port moves with it when the Edge Agent restarts
with the new deployment.

Each port can be open once on a host. If another connection that can
run on the same host already uses the port, the Manager refuses to save
and names that connection, so choose another port.

The address to use depends on how the Edge Agent is placed:

- **On a single-node edge cluster** the address is that machine's
  address on the plant network.
- **On a cluster with several hosts** pin the Edge Agent to one host
  (its host in the Manager) and use that host's address. An Edge Agent
  that is not pinned can move to another host when it restarts, and the
  device would then be sending to the wrong machine. While it is not
  pinned, the Manager treats it as on every host when it checks ports,
  so it refuses a port that any connection in the cluster uses.

Use a port that nothing else on the host uses. The host passes every
datagram for the port to the driver, so a program on the host listening
on the same port would stop receiving.

Leave the address of every metric empty and use the Data Selector to
pick each value out of the datagram, as the
[edge-udp README](../../edge-udp/README.md#addresses) explains.

## What the network must allow

Datagrams travel from the device to the edge host's port, and nothing
travels back, so only that one direction needs allowing:

- **Firewalls between the device and the host.** Allow UDP from the
  device's address to the host's address on the connection's port.
- **The firewall on the edge host itself** (for example `ufw`,
  `firewalld` or nftables rules). Allow UDP in on the port from the
  device's address or subnet.
- **Kubernetes network policies.** If the Edge Agent's namespace has a
  policy that denies ingress by default, add one that lets UDP on the
  port in from the device's subnet to the Edge Agent's pods. The
  datagrams keep the device's address, so the policy matches on that.
- **The cluster's network plugin** must support `hostPort`. The k3s
  default (flannel with the CNI `portmap` plugin) does. Other plugins
  may need it turned on.

## Fast devices: raise the host's receive buffer

The driver asks Linux for an 8 MiB receive buffer on its socket, so a
burst of datagrams waits in the kernel while the driver catches up. A
stock Linux host caps that at `net.core.rmem_max` (208 KiB) and doubles
it, so the driver gets 416 KiB. That is enough below about 1,000
datagrams a second. Above that, raise the cap on the edge host.

These are the losses measured when `edge-udp` was added, over 50,000
datagrams at 10,000 a second:

| Datagrams | Host left at the default (416 KiB buffer) | `rmem_max` raised (8 MiB buffer) |
|---|---|---|
| 100 bytes | 863 lost (1.7%) | none lost |
| JSON | 649 lost (1.3%) | none lost |
| 1,400 bytes | 1,132 lost (2.3%) | none lost |

With the cap raised, none were lost at 1,000, 2,000, 5,000 or 10,000 a
second in any of the three cases. Those runs were on one machine in
Docker, so treat them as a guide rather than a promise for every host.

To raise the cap, on the edge host as root:

```sh
sysctl -w net.core.rmem_max=8388608
echo 'net.core.rmem_max = 8388608' > /etc/sysctl.d/90-acs-udp.conf
```

The first line takes effect at once and the second keeps it after a
reboot. The driver sets its buffer when it opens the port, so the new
cap applies the next time the driver starts, for example when the Edge
Agent is next redeployed or its pod restarts.

## Checking it works

- The driver reports `UP` to the Edge Agent once it has opened the
  port, and the device's metrics start to update.
- If datagrams are lost, the driver logs a warning every 10 seconds in
  which any were dropped, saying how many and where: in the kernel
  (raise `rmem_max`) or in the driver's queue to the Edge Agent (the
  agent is not keeping up).
- If nothing arrives at all, check in this order: the device is sending
  to the host the Edge Agent is running on, the port matches the
  connection, the host and network firewalls let UDP through, and no
  network policy blocks it.
