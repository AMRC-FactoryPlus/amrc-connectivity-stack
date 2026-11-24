# Scanning a device for addresses

Edge Scout asks a device's driver to list the addresses the device
offers, such as the nodes of an OPC UA server or the topics on an MQTT
broker. You can then pick addresses in the origin map editor instead of
typing them, map many at once, and see what changed on the device since
the last scan. This page explains how to do that. The formats behind it
are in the [Edge Scout reference](edge-scout-reference.md), and what
each driver finds is in [Edge Scout driver notes](edge-scout-driver-notes.md).

A scan reads from the device and never changes it, and it never changes
the origin map by itself. Nothing you pick is stored until you press
**Save** in the origin map editor, as for any other edit. Data
collection carries on while a scan runs.

## Before you start

You need all of these:

- **Administrator rights.** Scanning needs the "Scan device addresses"
  permission, which only administrators hold in this release. Other
  users can still open a scan someone else ran, if they can read it.
- **A saved and deployed device.** A scan belongs to a connection, and
  the Addresses panel lives in a device's origin map editor. The
  connection needs at least one device, saved and deployed to its Edge
  Agent, because the Admin UI leaves a connection with no devices out
  of the Edge Agent's configuration, so its driver never starts.
- **An Edge Agent and a driver from this ACS release or later.** An
  older Edge Agent cannot scan, and a driver built on an older driver
  library answers that it was built before scouting.
- **A driver that can scan.** OPC UA, MQTT, the simulator and the two
  test drivers can. Every other driver in ACS, which is Modbus, ADS,
  BACnet, FTP, Pathfindr, RTDE, Open Protocol, TP-Link smart plug,
  REST, UDP and FOCAS, cannot, and the panel says the driver can't list
  its addresses. See [the driver table](edge-scout-driver-notes.md#which-drivers-can-scan).

## Run a scan

1. Open the device in the Admin UI and open its origin map editor.
2. Press **Addresses** in the editor's header. The Addresses panel
   opens on the right, beside the schema tree and the metric pane. The
   number on the button is how many addresses the last scan found. On a
   narrow screen the panel opens over the metric pane. On a wide screen
   you can drag its left edge to resize it, and the browser remembers
   the width.
3. If the driver has scan options, press **Options** to see them. Each
   driver's options are in [the driver notes](edge-scout-driver-notes.md).
   The defaults suit most devices.
4. Press **Scan**. The button's tooltip says what the driver does, such
   as "Scan the server's address space".

While the scan runs, the panel shows how many addresses it has found
and for how long it has been running, such as "Found 3,420 addresses,
41 s", with a **Stop** button. If an earlier scan exists, it stays on
screen under "Showing the scan of 24 Nov 10:42 until this one
finishes."

When the scan finishes, the panel shows the addresses as a tree, and
its header says how many there are and when they were scanned, such as
"9,812 addresses, scanned 24 Nov 10:42".

Every scan uses the Edge Agent's default limits: at most 20,000
addresses, 8 levels deep and 120 seconds, with a 20 ms pause between
requests to the device. Current values are not read, so the sample
column stays empty. If a limit stops a scan early, the panel says
which, and you can scan one branch at a time to see the rest.

Only one scan runs on a connection at a time, and an Edge Agent runs
one scan at a time across all its connections unless your site has
raised that. A second operator who opens the panel during a scan sees
the same scan running, with its **Stop** button in place of Scan. If
two people press Scan at the same moment, the second is told a scan is
already running and can choose **Follow the running scan**.

## Find an address

The tree shows each address's name, its address, its type, whether it
can be read or written (`r`, `w` or `rw`), and which metric already
uses it. The "mapped to" chip covers every device on the same
connection, because they share one scan.

- **Search** with the box above the tree. It matches names, addresses,
  paths, descriptions and units, and shows each match with the folders
  above it and a count of matches.
- **Filter** with the buttons under the search box: **Values only**,
  **Not mapped** (not used by any device on this connection), **New
  since last scan**, **Writable**, and a type list.
- **Use the keyboard.** The arrow keys move up and down, Home and End
  jump to the first and last row, Right and Left open and close a
  folder, Space ticks a row for bulk mapping, and Enter uses the
  address for the selected metric.

Every name and description in the tree comes from the device, so the
panel shows it as plain text.

## Use an address for a metric

You can fill in a metric from the scan in three ways:

- **From the tree.** Select the metric in the schema tree, then select
  the address in the Addresses panel and press **Use** or Enter.
- **Pick from scan.** In the metric pane, press **Pick from scan**
  next to the Address field. The panel shows "Choose the address for
  <metric>", and the next value you click is used. Press **Cancel** to
  stop picking. The button shows only when the connection has a scan.
- **Drag.** Drag a row from the Addresses panel onto any metric in the
  schema tree. The metric does not have to be selected, and it does
  not need an origin map entry yet. The editor creates the entry for
  you, with the same defaults it gives a metric you select.

Each of these fills in the metric's:

- **Address and Path**, always.
- **Sparkplug type**, only when it is not set yet and the metric's
  schema allows the scanned type. The scan gives a type without byte
  order, such as `Int16`. The editor uses that name if the schema
  allows it, and otherwise `Int16BE`, then `Int16LE`.
- **Engineering unit**, only when the metric has none and the unit is
  in the [engineering units vocabulary](../../services/engineering-units.md).
- **Documentation**, only when it is empty, from the address's
  description.

Folders cannot be used for a metric, because they have no address.

When you select a metric that has an address, the panel opens the tree
to that address and highlights it. If the last complete scan did not
find the address, the metric pane says "Not found in the scan of
24 Nov 10:42." If the scan found it with a different type, it says
"The scan found this address as Int32, but the metric's type is
Double."

Press **Save** when you are done. Until then nothing is stored.

## Map many addresses at once

1. Tick the addresses you want in the tree, with the boxes or Space.
2. Press **Map selected (n)**.
3. Choose how to map them:
   - **Map onto metrics** proposes a metric for each address by name.
     Names are compared in lower case with only their letters and
     digits, so `Motor_Speed` matches `motorSpeed`. When several
     metrics fit, the one whose parent matches the address's folder
     wins, then the one whose type matches. The Match column says
     **Matched**, **More than one**, **Type differs** or **No metric**.
     Change any row's metric with its list, choose **Do not map** to
     skip it, or untick it. "Another address also goes here." warns
     you when two addresses would land on the same metric.
   - **Create n objects named after the addresses** is offered when the
     schema has a collection that holds objects by name. Choose the
     collection and the metric inside each object that gets the
     address. Each address becomes one new object, named after the
     address's name. When that name does not fit, because it contains
     `/` or `.` or the collection's naming rule refuses it, the dialog
     offers the name with every run of characters other than letters,
     digits and `_` turned into one `_`, so `Motor.1` becomes
     `Motor_1`. You can edit the names. The dialog refuses a name that
     is empty, repeats another, contains `/` or `.`, or breaks the
     collection's naming rule, and says which.
4. Press **Apply n**. The addresses go into the origin map in the same
   way a CSV import does, and the editor shows the result.
5. Check the result and press **Save**.

Bulk mapping replaces an address that a metric already has, without
asking.

## Scan again and see what changed

Press **Re-scan** to scan the whole connection again. When the new
scan finishes, a change bar appears above the tree with a count for
each kind of change. Press a count to show only those addresses.

Count|What it means
---|---
**New**|In this scan and not the one before
**Changed**|The same address with a different type, access, kind or array size. A different name only shows as **Renamed**
**Gone**|In the scan before and not in this one. Shown only when the two scans can be compared
**Not seen this time**|In the scan before and not in this one, when the two scans cannot be compared
**Mapped but missing**|Metrics on this device whose address this scan did not find
**Mapped, not seen**|Metrics whose address this scan did not find, in a part of the device the scan did not fully cover

Gone and missing addresses are not in the tree, so the change bar lists
them, and you can press a missing metric to select it.

Two scans can be compared only when both listed everything they could,
neither stopped at a limit, and both used the same options, the same
starting point and skipped the same parts of the device. When they
cannot be compared, the change bar says why:

- "This driver cannot list everything, so addresses it did not see are
  shown as not seen, not gone." MQTT scans are always like this,
  because a topic that was quiet while the scan listened is missing
  but not gone.
- "One of the scans stopped early, so addresses it did not reach are
  shown as not seen."
- "The two scans used different options, so they cannot be compared."
- "The two scans started in different places, so they cannot be
  compared."
- "The two scans skipped different parts of the device, so they cannot
  be compared."

"Mapped but missing" needs a scan of the whole device that listed
everything and did not stop at a limit. An address in a part of the
device the scan skipped on purpose is never called missing. For
example, OPC UA scans skip the Server object, so `CurrentTime` and
`ServerStatus` metrics are never flagged.

If the connection's settings changed after the scan, the panel says
"The connection's settings changed after this scan. Scan again to see
the device as it is now."

The panel keeps the last two complete scans. A failed or stopped scan
never replaces them.

## Scan one branch

A folder row has a **Scan this branch** button. It scans only that
folder and puts the result in place of the folder in the current scan,
so the rest of the tree stays as it was. Use it to see more of a device
after a scan stopped at a limit, or to refresh one part of a large
device. The change bar then covers only that branch. Branch scans need
a complete scan of the connection first.

## Stop a scan

Press **Stop**. The driver stops within a few seconds, the panel says
"The scan was stopped. The last complete scan is still shown.", and the
previous scan stays as it was.

## What the panel can say

The panel works out what to show from the state of the Edge Agent, the
driver and the last scan, and shows the first of these that applies.

State|What the panel says|What to do
---|---|---
No panel|The Addresses button is missing|The driver's definition turns scanning off. Type addresses in the metric pane
Edge Agent offline|"The Edge Agent is offline, so it can't scan."|Bring the Edge Agent back. A previous scan stays browsable
Edge Agent too old|"This Edge Agent can't scan. Upgrade it to the current ACS release."|Upgrade the Edge Agent
Untrusted status|"The scan status for this connection was written by an Edge Agent that does not host it, so the panel ignores it."|Check that the device's connection is on the Edge Agent you expect. A scan from the right Edge Agent replaces the entry
Not deployed|"Save and deploy this connection before scanning it."|Save the device and wait for the Edge Agent to load its configuration, then press Scan
Driver cannot scan|"The REST driver can't list its addresses. Type them in the metric panel."|Type addresses in the metric pane
Driver too old|"This driver was built before scouting. Update the driver image."|Deploy the driver image from this ACS release. For a driver from outside ACS, deploy an image built on the driver library from this release
Driver not running|"The driver isn't ready." with the reason it reported, such as a configuration problem, an address it could not read, or that it cannot reach the device|Fix the driver's problem, which the device's status and the driver's log show, then press Try again
No permission|Scan is greyed out, with "Scanning needs the Scan device addresses permission."|Ask an administrator to scan. You can still browse a scan that exists
Never scanned|"A scan asks the driver to list the addresses its device offers, so you can pick them instead of typing them. Data collection carries on while it runs."|Press Scan
Sending|"Sending the request to the Edge Agent."|Wait a moment
Waiting|"The Edge Agent didn't record the request. Its log says why, and a missing grant is the usual cause."|The Edge Agent had not recorded the request 15 s after it was sent. Check its log and that service-setup has run for this release, then press Try again
Refused|A reason from the codes table below|See the table
Queued|"The scan is waiting for the Edge Agent to start it."|Wait, or press Stop
Running|"Found 3,420 addresses, 41 s."|Wait, or press Stop
Found nothing|"The scan found no addresses." For MQTT: "Nothing was published in the 10 s window." For the simulator: "The scan found no addresses. Load a cassette first."|Check the options. For MQTT, try a longer window or other topic filters. For the simulator, load a cassette
Done|The tree|Use the addresses
Stopped|"The scan was stopped. The last complete scan is still shown."|Press Try again when you want a new scan
Failed or interrupted|A reason from the codes table below|See the table

The panel can also show these notes above the tree:

Note|What to do
---|---
"The scan stopped at the address limit, so it is not complete. Scan a branch to see more of it." The limit may also be the depth limit, the time limit, the size limit, or "parts the driver was not allowed to read"|Scan the branches you need one at a time
"The connection's settings changed after this scan. Scan again to see the device as it is now."|Re-scan
"The scan result could not be read." with the reason|The stored scan is damaged or could not be downloaded. Re-scan
"Showing the scan of 24 Nov 10:42 until this one finishes."|Nothing. The new scan replaces it when it finishes

### Codes

When a scan is refused or fails, the panel shows the plain-words text
for its code, followed by any detail the Edge Agent or driver gave.

Code|What the panel says|What to do
---|---|---
`REQUEST`|"The Edge Agent could not read the request."|The Admin UI and the Edge Agent may be from different releases. Upgrade them together
`UNDEPLOYED`|"The Edge Agent has not loaded this connection yet. Save and deploy it, then try again."|Save the device, wait for the Edge Agent, try again
`NODRIVER`|"The driver isn't ready." and the reason|Wait for the driver to start, or fix its configuration, then try again
`LIBRARY`|"This driver was built before scouting. Update the driver image."|As for "Driver too old" above
`BUSY`|"A scan is already running on this connection."|Press Follow the running scan
`LIMIT`|"The Edge Agent is already running as many scans as it allows. Try again when one finishes."|Wait for scans on other connections to finish
`NOTRUNNING`|"There was no scan to stop."|Nothing. The scan had already ended
`UNSUPPORTED`|"This driver can't list its addresses."|Type addresses in the metric pane
`OPTIONS`|"The driver did not accept the scan options." and which one|Fix the option the message names. For a branch scan, re-scan the whole connection first, because the folder may have gone
`CONN`|"The driver is not connected to the device." and the reason|Check that the device is reachable, then try again
`AUTH`|"The device refused the driver." and the reason|Check the connection's credentials. For MQTT, the broker may refuse the topic filters: give narrower ones
`CANCELLED`|"The scan was stopped."|Nothing. Someone pressed Stop, or the connection's settings changed during the scan
`ERR`|"The driver failed during the scan." and the reason|Check the driver's log, then try again
`TIMEOUT`|"The scan took too long, or the driver stopped answering."|Check the driver's log. Scan a branch to make the scan smaller
`LOST`|"Messages from the driver went missing, so the scan stopped."|Try again. If it repeats, check the Edge Agent's host for load
`INTERRUPTED`|"The Edge Agent or the driver restarted during the scan."|Try again
`STORE`|"The Edge Agent could not save the result." and the Files or ConfigDB answer|Check that service-setup has run for this release, so the Edge Agent has its grants, and that the Files service is up
`AGENT`|"The Edge Agent failed during the scan." and the reason|Check the Edge Agent's log. A driver that sends invalid messages also gives this

## Load on the device and the Edge Agent

A scan is real work for the device. An OPC UA scan browses the server
one request at a time with a pause between requests and backs off when
the server says it is busy. An MQTT scan opens a second, short-lived
connection to the broker and listens for 10 seconds by default. Data
collection carries on during both. Scan production equipment when it
can spare the load, and prefer a branch scan to a full one on a large
server.

On the Edge Agent, live data comes first. The agent works on a scan
only while it has CPU to spare under its limit, and the driver may send
only a few messages ahead of what the agent has handled, so a scan on a
busy or small Edge Agent takes longer instead of delaying data.
Measured with the edge-agent chart's 100m CPU and 200Mi memory, a
50,000-address scan took about 21 seconds, memory stayed under
114 MiB, and data from the same agent reached Sparkplug as usual during
it, with a median delay of 12 ms and a 95th percentile of 22 ms. Expect
a longer scan on an Edge Agent that is already busy with data.

## Drivers with their own metric panel

Some drivers replace the metric pane's standard fields with their own
panel. The **Pick from scan** button is then not shown, but the
Addresses panel still works beside the driver's panel, so you can still
drag addresses onto metrics. A driver panel written for Edge Scout can
open the same address picker from a button of its own. It cannot start
a scan.

## Next steps

- [Edge Scout driver notes](edge-scout-driver-notes.md) - what each driver finds, its options and its limits
- [Edge Scout reference](edge-scout-reference.md) - the status entry, snapshots, codes, permissions and settings
- [Edge Scout design](edge-scout.md) - how it works and why
