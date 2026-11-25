# Design preview

Renders the schema editor surfaces against fixture data, with no
authentication and no ConfigDB, so the UI can be seen and screenshotted
without a deployment.

Not part of the shipped application. `index.html` lives here rather than
at the project root, so `vite build` does not pick it up.

    bun run dev
    open http://localhost:5173/preview/index.html

Surfaces are selected by query parameter, after the hash:

| URL | Shows |
|---|---|
| `#/?surface=list` | the schema list |
| `#/schemas/draft/dddddddd-0000-4000-8000-000000000001?surface=editor` | the composer, mid-authoring |
| `#/schemas/4701e66e-0f77-42b0-8ddd-cef60db6ef4a?surface=editor` | a library schema, read-only |
| `#/?surface=publish-breaking` | publish gate, breaking change |
| `#/?surface=publish-additive` | publish gate, safe change |
| `#/?surface=publish-blocked` | publish gate, blocked on a draft component |
| `#/?surface=component-picker` | the component picker |
| `#/?surface=raw` | the raw JSON escape hatch |
| `#/?surface=i3x-device` | a device with its i3X access button; click it for the dialog |
| `#/?surface=i3x-isa95` | the ISA-95 page, with the i3X access column |
| `#/?surface=scout` | the Edge Scout Addresses panel with a scan and a previous scan, beside the real metric fields |
| `#/?surface=scout&state=running` | the same, mid-scan. Also `never`, `offline`, `noperm`, `refused`, `failed`, `unsupported`, `empty` and `truncated` |
| `#/?surface=scout&live=ask` | the panel with the Live values dialog open. `&live=on` turns live values on without the dialog, and a fake Edge Agent reads the rows on screen every 5 s, with one address that fails. Add `&dropped=7` for an agent that left 7 addresses out at its cap of 40 |
| `#/?surface=scout&reads=0` | the Live values switch disabled because the driver can't read values. `&reads=none` is an Edge Agent or driver that does not say, as before live values. `state=offline` and `state=noperm` disable it too |
| `#/?surface=scout&open=0` | the metric pane with the Addresses panel closed. `&popout=1` starts the panel popped out into the large view |
| `#/nav?surface=nav&acl=none&page=configdb` | the sidebar for one user, beside a page behind its access gate. `acl` is `none` (only the grants every principal gets), `empty` (no ACL entries at all), `device` (Device data on one device), `root` or `loading`; `page` is a section key from `src/lib/access/sections.js` |
| `#/edge-clusters/c/nodes/n/devices/d0000000-0000-4000-8000-00000000c001?surface=nav&acl=device` | the device page for a user who can't read device configuration |
| `#/?surface=driver-ui` | the driver custom UI contract version 2 test document in a real sandboxed frame, with the Manager's picker. Add `&scan=none` for no scan, `&samples=1` to share samples, or `&v=1` to declare it as version 1, so the host ignores its version 2 messages and falls back to the standard fields |

The fixtures are real schemas from the AMRC library, plus a local fork
with a superseded v1, a draft carrying a construct the composer does not
model, and four devices so the blast radius figures are non-zero.

The i3X surfaces use `i3x-fixtures.js` instead: a small ISA-95
vocabulary, devices placed in it, and grants that reach one device by
every route the dialog shows. Giving and removing access change those
fixture grants, so both can be walked through.

Screenshots taken from this are in `docs/assets/schema-editor/` and
`docs/assets/i3x-access-dialog/`.
