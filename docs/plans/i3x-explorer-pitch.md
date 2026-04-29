# Pitch: i3X Explorer in ACS Admin

## Problem

Operators and engineers working with ACS-connected equipment currently have no way
to browse the i3X information model from within the admin UI. The standalone i3X
Explorer (Electron/React) exists but it's a separate tool with separate auth,
separate context, and no integration with the ACS ecosystem. Users should be able
to explore the hierarchy, inspect live values, view history, and monitor items —
all from the same interface they already use to manage edge clusters and devices.

## Appetite

**Big batch — 6 weeks.** This is a flagship feature that demonstrates ACS's i3X
compliance and gives operators a powerful, polished data exploration tool.

## Solution

A new **Explorer** page in acs-admin that talks to the `acs-i3x` service (`/v1/`
API), providing hierarchy browsing, node inspection, relationship visualization,
historical data, and live monitoring.

### Element 1: Explorer Page with Hierarchy Tree

A new route `/explorer` with its own nav entry below Home. The page has three
panels:

- **Left panel** — Hierarchy tree built from i3X objects. Loads roots via
  `GET /objects?root=true`, expands children lazily via
  `GET /objects/:id/related?relationshiptype=i3x:rel:has-children`. Search/filter
  box at top. Icons distinguish compositions (folder) from leaves (dot). Click
  selects a node.

- **Main panel** — Shows relationship graph, current value, and history for the
  selected node (details below).

- **Right sidebar** — Node metadata following existing `SidebarDetail` + `Copyable`
  patterns: Element ID, Type ID, Parent ID, Namespace URI, Composition flag.
  Subscribe button at bottom.

### Element 2: Relationship Graph (Cytoscape.js)

Interactive graph in the main panel showing the selected node and its
relationships. Uses Cytoscape.js (lazy-loaded) with a breadthfirst or concentric
layout.

- Depth slider (1-3) controls how many hops are fetched
- Each depth level is a **single bulk call** via `POST /objects/related` with all
  node IDs at that depth — keeps API calls to O(depth), not O(nodes)
- Click any node in the graph to navigate to it (updates tree + sidebar +
  everything)
- Current node highlighted, relationship types shown on edges
- Pan, zoom, fit-to-screen controls

### Element 3: Current Value with Quality

Card showing the live value for the selected node:

- Value, quality badge (colour-coded: green/yellow/grey/red for
  Good/Uncertain/NoData/Bad), timestamp
- Manual refresh button (calls `GET /objects/:id/value`)
- For compositions: mini-table of component values

### Element 4: History with Time Range (ECharts)

Explicit-load history section:

- Preset time range buttons: 1h, 6h, 24h, 7d, Custom (date picker)
- "Load History" button — calls `POST /objects/history` with selected range
- ECharts (tree-shaken, lazy-loaded) renders the time series with:
  - Data zoom slider/brush at bottom
  - Crosshair tooltips
  - Quality markers on the timeline
- **CSV export** button downloads the loaded history data as `.csv`
- For compositions: message directing user to select a leaf metric

### Element 5: Monitored Items (Navbar Dialog)

A button in the navbar (left of the sidebar toggle) with a red badge showing count
of new values since the dialog was last opened.

Clicking opens a dialog/sheet showing monitored item **cards**, each with:

- Display name + quality badge
- Current value + timestamp
- Inline ECharts sparkline/trend (rolling window of recent values)
- Unsubscribe button per card

**Lifecycle:**

- Backed by a Pinia store + SSE stream via `@microsoft/fetch-event-source`
  (POST support)
- Stream stays alive regardless of dialog open/close — dialog is just a viewport
- Red badge increments while dialog is closed and new data arrives
- On page close (`beforeunload`): prompt "You have X active monitors. Stop
  monitoring?"
- Session-only — no localStorage persistence

## Rabbit Holes

| Hole | Resolution |
|---|---|
| POST SSE not supported by native EventSource | Use `@microsoft/fetch-event-source` (~3KB) |
| Graph depth fan-out (exponential API calls) | Bulk `POST /objects/related` per depth layer; cap at 3 |
| Bundle bloat from Cytoscape + ECharts | Lazy dynamic `import()` on Explorer page only; tree-shake ECharts |
| History for compositions returns empty | UI guides user to select leaf metric |
| Subscription cleanup on tab close | `beforeunload` prompt + server 5-min TTL as safety net |
| Spec compliance | All API usage strictly within i3X v0.1.0 spec — no extensions |

## No-Gos

- Namespaces and Object Types views (future cycle)
- Auth delegation (acs-i3x is currently auth-less; placeholder header for future)
- Writing/updating values (acs-i3x capability is `update.current: false`)
- Extending the i3X spec with custom parameters
- Persisting subscriptions across sessions

## New Packages

| Package | Purpose | Size (gzipped) |
|---|---|---|
| `cytoscape` | Relationship graph | ~130KB |
| `vue-echarts` + `echarts` | History charts + sparklines | ~200KB (tree-shaken) |
| `@microsoft/fetch-event-source` | POST-based SSE for subscriptions | ~3KB |

All lazy-loaded — zero impact on existing page load times.
