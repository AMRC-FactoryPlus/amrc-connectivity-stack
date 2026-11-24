# Driver-supplied configuration UIs

## Why

Every driver in ACS gets the same two free-text boxes for a metric: "Device
Address" and "Metric Path". A driver definition's `presentation` block can
change the label, help text, icon and placeholder around those boxes, but it
cannot change the fact that they are boxes.

So driver authors encode structure into strings. ADS invented
`symbol_name,cycle_time`. RTDE invented `json/jointData`. The test driver
invented `sin:3000:50:bd`. Each is a private mini-language documented in a
different README, and the operator has to learn it before they can configure
anything.

A driver author knows exactly what shape their input takes. This lets them
say so.

## What a custom UI replaces

**Only the per-metric configuration region:** address, path, Sparkplug type,
engineering units and limits, deadband, historian flag.

Everything else in the origin map editor stays exactly as it is: the tag
tree, schema selection, static values, and the CSV import and export path.
A custom UI is one focused form panel, not a replacement editor.

## Shipping one

Add a `ui` key to the driver definition, in the same dump that already
carries the driver's `schema` and `presentation`:

```yaml
!u ACS.Driver.YourDriver:
  image:
    repository: edge-yourdriver
  polled: true
  presentation:
    # Still used when the custom UI is unavailable or declined.
    address: { title: "Address", ... }
  ui:
    version: 1
    document: |
      <!doctype html>
      <html>...</html>
  schema:
    # ...
```

There is no second artefact to distribute. A third-party driver already has
to get its definition into ConfigDB, and the deploy chart supports that
today through the `EXTRA_DUMPS` ConfigMap mounted at `/dumps` by
`deploy/templates/service-setup.yaml`. Shipping a UI is one more key in a
file you were writing anyway.

### Size budget

The **whole driver definition** must fit inside ConfigDB's body limit, which
is 100kb by default (`configdb.bodyLimit` in `deploy/values.yaml`). A
self-contained vanilla HTML panel fits comfortably; a bundled framework does
not. Sites that genuinely need more can raise the limit, but the intent is
that these panels stay small.

## The sandbox

A driver document is third-party code running in the operator's browser, so
two independent mechanisms contain it.

**The iframe carries `sandbox="allow-scripts"` and deliberately not
`allow-same-origin`.** The document gets an opaque origin and cannot reach
the console, its storage, its tokens or the operator's session.

**The frame is served with its own Content-Security-Policy.** It is loaded
from `/driver-ui/host.html` rather than via `srcdoc`, because a srcdoc frame
inherits the embedder's policy and that would force the whole console to
permit inline script. Its own policy is `default-src 'none'` with inline
script and style allowed, so the document **cannot fetch, XHR, open a
WebSocket, or load any subresource**. See `acs-admin/.docker/nginx.conf`.

Two consequences for authors:

- **Your document must be entirely self-contained.** No external scripts,
  stylesheets, fonts or images. Inline everything, or use data: URIs.
- **You cannot call your own API.** A panel describes the shape of a
  protocol, not the contents of a particular deployment. If your UI needs a
  device's serial number or node id, ask the operator for it.

The connection config is passed to the panel with **secrets redacted**: any
property your connection schema marks `format: password` arrives as
`"__redacted__"`. Do not design a panel that needs a credential.

## The contract

Messages carry `fpDriverUi: 1` as a discriminator so the console can share a
window with other postMessage traffic. The exchange is:

```
  shell page loads
      │
      │  { fpDriverUi: 1, type: "host-ready" }          shell  → Manager
      │
      │  { fpDriverUi: 1, type: "document", document }  Manager → shell
      │  (the shell writes your document and steps aside)
      │
      │  { fpDriverUi: 1, type: "ready" }               panel  → Manager
      │
      │  { fpDriverUi: 1, type: "init",                 Manager → panel
      │    config, metric, constraints, theme }
      │
      │  { fpDriverUi: 1, type: "propose", values }     panel  → Manager
      │  { fpDriverUi: 1, type: "resize", height }      panel  → Manager
```

**Announce `ready` only once your message listener is attached.** The
Manager sends `init` in response, so announcing early races your own
listener. If nothing announces within 5 seconds, the Manager gives up and
shows the standard fields.

### `init`

| Field | Meaning |
|---|---|
| `config` | Connection configuration, secrets redacted |
| `metric` | Current values of the metric being edited |
| `constraints.proposable` | Field names you may propose |
| `constraints.allowed_types` | Sparkplug types this metric permits |
| `theme` | Colour, radius and font tokens from the console |

Use `metric` to restore your controls when an operator reopens a metric they
configured earlier, and `allowed_types` to pick a type the schema actually
permits rather than assuming one exists.

Theme tokens are passed, not enforced. A panel that ignores them will look
foreign.

### `propose`

Send the fields you want set. The Manager validates every one against an
allowlist and the metric schema before anything reaches the model, so a
malformed proposal is reported rather than applied:

| Field | Type |
|---|---|
| `Address`, `Path`, `Eng_Unit`, `Documentation` | string |
| `Eng_Low`, `Eng_High`, `Deadband` | finite number |
| `Sparkplug_Type` | one of `constraints.allowed_types` |
| `Record_To_Historian` | boolean |

`null` clears a field. Keys outside the allowlist are dropped silently, so a
panel written against a later contract degrades rather than breaking.

## Contract version 2: Edge Scout

Version 2 lets a panel use [Edge Scout](edge-scout-scanning.md), the
list of addresses a scan found on the device's connection. A panel
replaces the standard fields, so the operator loses the standard
**Pick from scan** button. Version 2 gives the panel its own way to
pick, and lets it read the scan to draw its own list. Everything in
version 1 works the same in version 2.

To use it, declare version 2 in the driver definition and send version
2 in your messages:

```yaml
ui:
  version: 2
  document: |
    ...
scout:
  share_samples: false
```

- **The envelope.** Every message between the Manager and your document
  carries `fpDriverUi: 2`. The Manager answers each document in the
  version its driver definition declares, so a version 1 document such
  as Pathfindr's keeps getting version 1 messages. A version 1 message
  that carries a version 2 type is ignored.
- **The shell stays on version 1.** The shell page's own messages,
  `host-ready`, `host-failed` and `document`, always carry
  `fpDriverUi: 1`. Your document never sees them.
- **No scans from the sandbox.** No message starts or stops a scan, so
  third-party code in the sandbox can never put load on production
  equipment. Only an operator pressing Scan in the Addresses panel
  can.

The exchange adds these messages:

```
  { fpDriverUi: 2, type: "init", ..., scout }        Manager → panel
  { fpDriverUi: 2, type: "scout-changed", scout }    Manager → panel

  { fpDriverUi: 2, type: "pick-address", filter }    panel  → Manager
  { fpDriverUi: 2, type: "picked", item }            Manager → panel

  { fpDriverUi: 2, type: "scout-query", prefix, limit }  panel → Manager
  { fpDriverUi: 2, type: "scout-items", items }      Manager → panel
```

### `init.scout` and `scout-changed`

A version 2 `init` has one more field, `scout`, a summary of the
connection's scan:

| Field | Meaning |
|---|---|
| `available` | `true` when there is a complete scan to pick from |
| `state` | The latest scan's state: `queued`, `running`, `done`, `failed`, `cancelled`, or null when the connection has never been scanned |
| `finished` | When the current scan finished, as an ISO 8601 string, or null |
| `items` | How many items the current scan has, or 0 |

The Manager sends `scout-changed` with the same `scout` object when a
scan starts, finishes or fails while the panel is open, so the panel
can enable or update a "choose from the scan" control.

### `pick-address`

Send `pick-address` to open the Manager's own address picker over your
panel. The picker shows the scan's tree with a search box. `filter` is
optional:

| Field | Meaning |
|---|---|
| `prefix` | Show only items whose address starts with this, at most 1024 characters |
| `kind` | `value` or `folder`, to show only that kind |

The Manager answers with `picked`. `item` is the item the operator
chose, in the [item format](edge-scout-reference.md#fpedge1-protocol-additions),
or null when the operator closed the picker, the connection has no
scan, or a picker was already open. A second `pick-address` while the
picker is open is answered with `item: null` at once.

To use the item, send `propose` as usual, for example
`{ Address: item.address, Path: item.path }`. The same allowlist and
checks apply.

### `scout-query`

Send `scout-query` with a `prefix` (a string, possibly empty) and a
`limit` to read items without the picker. The Manager answers with
`scout-items`, holding the items whose `address` starts with `prefix`,
in the order the scan found them. `limit` is cut to 500, and a missing
or bad `limit` means 500. With no scan, `items` is empty. A
`scout-query` without a string `prefix` is ignored.

### Samples

An item's `sample` is the device's value when it was scanned, which
may be sensitive. The Manager removes `sample` from every item it
sends to a panel unless the driver definition sets
`scout.share_samples: true`.

### Item strings are untrusted

Every string in an item comes from the device. Show it with
`textContent`, never `innerHTML`, as the test document does.

### Test document

`acs-admin/test/fixtures/driver-ui/scout-v2.html` is a working version
2 panel. It shows the scan summary, lists two addresses with
`scout-query`, and has a button that opens the picker and proposes the
chosen address. `acs-admin/test/driver-ui-v2-host.test.js` runs it in
the real shell page in jsdom. Copy its shape.

## Falling back

The standard fields are shown whenever:

- the driver definition has no `ui` key;
- its `version` is one the Manager does not recognise;
- the document fails to load, or never announces itself within 5 seconds;
- the operator clicks **Use standard fields**.

That last one matters. A broken, confusing or outdated vendor UI must never
be a wall between an operator and a metric they need to configure. When a
custom UI is available but suppressed, a **Use the driver's interface**
control appears to go back.

## Worked example

`edge-pathfindr` ships one. The source is at
`edge-pathfindr/ui/metric-panel.html`, it is inlined into the dump by
`edge-pathfindr/tools/inline-ui.js`, and `edge-pathfindr/test/ui-sync.test.js`
fails if the two drift. Copy its shape.

## Next Steps

- [Scanning a device for addresses](edge-scout-scanning.md) - Edge Scout, which contract version 2 reads from
- [Edge Deployments](edge-deployments.md) - deploying to edge clusters
- [Edge Management Overview](overview.md) - return to the edge management overview
