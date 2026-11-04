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

The fixtures are real schemas from the AMRC library, plus a local fork
with a superseded v1, a draft carrying a construct the composer does not
model, and four devices so the blast radius figures are non-zero.

The i3X surfaces use `i3x-fixtures.js` instead: a small ISA-95
vocabulary, devices placed in it, and grants that reach one device by
every route the dialog shows. Giving and removing access change those
fixture grants, so both can be walked through.

Screenshots taken from this are in `docs/assets/schema-editor/` and
`docs/assets/i3x-access-dialog/`.
