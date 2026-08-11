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

- [Edge Deployments](edge-deployments.md) - deploying to edge clusters
- [Edge Management Overview](overview.md) - return to the edge management overview
