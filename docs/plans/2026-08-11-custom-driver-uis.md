# Custom driver UIs in the Manager

## Problem

Look at what a driver author does today when their addresses are not paths.

The Pathfindr API has no address strings in it. It has a choice of data type
(where is this asset, how warm is it, how long has it run) and an asset serial
number. Two structured inputs. But the only thing the Manager offers is a
free-text box labelled "Device Address", so the driver author has to invent a
grammar, `assets/SN12345`, write it down in a README, and hope the operator
reads it.

That grammar does not exist because it is a good way to identify an asset. It
exists because a text box was the only thing available.

Every driver does this. ADS invented `symbol_name,cycle_time`. RTDE invented
`json/jointData`. The test driver invented `sin:3000:50:bd`. Each is a private
mini-language, documented in a different README, that an operator has to learn
before they can configure anything. `SparkplugMetric.vue` renders an input for
Address and an input for Path, and the DriverDef `presentation` block can only
change the label, help text, icon and placeholder around those two boxes. It
cannot change the fact that they are boxes.

The driver author knows exactly what shape their input takes. They have no way
to say so. So they encode it in a string and document it elsewhere, and the
operator becomes a parser.

## Appetite

8 days.

## Solution

A driver definition can carry its own interface for the part of metric
configuration that is actually driver-specific. The Manager renders it in a
sandbox in place of the standard fields.

### What it replaces, and what it does not

Only the per-metric configuration region: address, path, data type, engineering
limits and the rest of the per-metric inputs. The origin map editor keeps
everything else, and keeps it exactly as it is now. The tag tree, schema
selection, static values, the CSV import and export path, and the Sparkplug
machinery are all untouched.

This matters because the origin map editor is roughly 3,100 lines across seven
components, with `OriginMapEditor.vue` alone at 1,283. A feature that asked a
driver author to reimplement that would be used exactly once, by us. A feature
that asks for one focused form panel might get used by someone else.

### Delivery

The UI is a self-contained HTML document carried inline in the driver
definition, in the same dump that already delivers the driver's schema and
presentation config.

There is no new infrastructure here and no second artefact to distribute. A
third-party driver already has to get its DriverDef into ConfigDB somehow, and
the answer is already "add this dump to your `values.yaml`", which the deploy
chart supports today through the `EXTRA_DUMPS` ConfigMap mounted at `/dumps`
by `deploy/templates/service-setup.yaml`. Shipping a UI becomes one more key
in a file the author was writing anyway. Nothing is uploaded by hand, nothing
is extracted from a container image, and nothing has to reach the edge.

### Elements

**1. A `ui` key in the driver definition** holding a self-contained HTML
document. No external references, since the sandbox cannot fetch them.

**2. A sandboxed iframe** in the per-metric region. Null origin, no
`allow-same-origin`, so the document cannot reach the console's DOM, tokens or
session.

**3. A versioned postMessage contract.** The Manager sends the connection
config, the current metric values and the metric schema. The UI sends back
proposed metric values. The Manager validates them against the schema and is
the only thing that ever writes to ConfigDB. The custom UI is a pure function
from inputs to proposed values, and is never trusted with anything else.

**4. Theme tokens in the init message,** so a custom UI that wants to look
native can, and the feature reads as built in rather than bolted on.

**5. A "use standard fields" toggle** alongside any custom UI, mirroring the
existing static-value toggle. A broken, confusing or outdated vendor UI must
never be a wall between an operator and a metric they need to configure.

**6. Fallback in every failure case.** No `ui` key, a document that fails to
load, an unknown contract version, or a UI that never responds all resolve to
today's standard fields. Every existing driver keeps working with no change.

**7. A Content-Security-Policy** on the admin console's nginx config. There is
none today. This is the change that introduces foreign content, so it is the
change that should add one.

### Flow

```
Device > Origin Map                    the origin map editor, unchanged
────────────────────────────────────
  tag tree, schema selection, static values, CSV      all as today
        │
        ▼
  Per-metric region                    the only part that changes
        │
        ├── DriverDef has no `ui` ──▶  standard Address / Path / type fields
        │
        └── DriverDef has `ui` ────▶  sandboxed iframe
                                          │
                 init  ─────────────────▶ │  config, current values,
                                          │  metric schema, theme tokens
                                          │
                 propose ◀──────────────  │  proposed metric values
                                          │
                                       Manager validates against schema
                                          │
                                          ▼
                                       written to ConfigDB
                 [use standard fields]  ──▶ back to the standard region
```

## Rabbit Holes

**The contract is the actual product.** Everything else is replaceable; the
message format is not, because every custom UI ever written depends on it.
Version it from the first commit. The Manager reads the version a UI declares
and falls back to standard fields on anything it does not recognise, rather
than attempting to interpret it.

**The 100kb budget.** ConfigDB's body limit is 100kb (`deploy/values.yaml`,
`configdb.bodyLimit`), and that covers the whole config entry, not just the
UI. A vanilla HTML form panel fits comfortably; a bundled framework does not.
Document the budget as part of the contract. Sites that genuinely need more can
raise `configdb.bodyLimit`, which is already a values key, and that is the
documented answer rather than a second delivery mechanism.

**Invalid values coming back.** The UI is untrusted, so treat its output as
untrusted input. Validate the proposed values against the metric schema, reject
anything that fails, surface the error, and leave the previous values in place.

**A UI that never responds.** A document that loads but never posts back would
otherwise leave the operator staring at an empty panel. Time out the handshake
and fall back to standard fields with a visible notice.

**Sandbox theming drift.** Theme tokens are passed, not enforced. A custom UI
that ignores them will look foreign, and that is the author's problem rather
than something the Manager should police.

## No-Gos

- **No replacing the whole origin map editor.** The tree, schema selection,
  static values, engineering units, historian flags and CSV path stay in the
  Manager's hands.
- **No live device or API access from the sandbox.** The UI receives static
  inputs. No credentials enter it, and there is no proxy for it to call.
- **No third-party code in the main console context.** No dynamic imports, no
  web components, no module federation. Sandboxed iframe or nothing.
- **No Files service delivery,** and no extraction of UI assets from driver
  container images.
- **No retrofit.** Existing drivers keep the standard fields until someone
  chooses to write a UI for one.
