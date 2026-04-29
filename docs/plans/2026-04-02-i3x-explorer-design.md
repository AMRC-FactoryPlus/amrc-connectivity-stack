# i3X Explorer Design — ACS Admin Integration

**Date:** 2026-04-02
**Pitch:** [i3x-explorer-pitch.md](./i3x-explorer-pitch.md)
**Status:** Approved, ready for implementation

## Architecture Overview

The Explorer feature adds a new `/explorer` route to acs-admin with five
components talking to the `acs-i3x` service at `/v1/`. All i3X-specific code
lives under `src/pages/Explorer/` and `src/store/` with a dedicated API client
composable.

```
acs-admin (Vue 3 + shadcn)
  |
  +-- src/composables/useI3xClient.js    -- API client (fetch-based)
  +-- src/composables/useI3xSSE.js       -- SSE via @microsoft/fetch-event-source
  +-- src/store/useExplorerStore.js       -- Tree state, selected node
  +-- src/store/useMonitorStore.js        -- Subscriptions, live values, trends
  +-- src/pages/Explorer/
  |     +-- Explorer.vue                  -- Page layout (3 panels)
  |     +-- ExplorerTree.vue              -- Hierarchy tree (left panel)
  |     +-- ExplorerTreeNode.vue          -- Recursive tree node
  |     +-- NodeDetail.vue                -- Right sidebar (metadata)
  |     +-- RelationshipGraph.vue         -- Cytoscape.js graph
  |     +-- CurrentValue.vue              -- Value + quality badge + refresh
  |     +-- HistoryPanel.vue              -- Time range + ECharts + CSV export
  +-- src/components/MonitorDialog.vue    -- Navbar monitored items sheet
  +-- src/components/MonitorButton.vue    -- Navbar button with red badge
  +-- src/components/QualityBadge.vue     -- Reusable quality indicator
```

## Component Design

### 1. API Client (`useI3xClient`)

Composable wrapping `fetch()` calls to acs-i3x. Handles the `{ success, result }`
envelope. Base URL configurable via env var `I3X_BASE_URL` (defaults to
`/i3x/v1` for proxied setup, or `http://localhost:8080/v1` for dev).

```js
// Usage
const i3x = useI3xClient()
const roots = await i3x.getObjects({ root: true })
const children = await i3x.getRelated(elementId, 'i3x:rel:has-children')
const value = await i3x.getValue(elementId)
const history = await i3x.getHistory({ elementIds, startTime, endTime })
```

Methods map 1:1 to acs-i3x endpoints. No abstraction beyond unwrapping the
envelope and throwing on `success: false`.

### 2. Explorer Store (`useExplorerStore`)

Pinia store managing:

- `tree`: Map of `elementId -> { node, children[], expanded, loaded }` for the
  hierarchy tree
- `selectedId`: Currently selected node elementId
- `selectedNode`: Computed — full i3X object for the selected node
- Actions: `loadRoots()`, `expandNode(id)`, `collapseNode(id)`, `selectNode(id)`

Tree nodes are loaded lazily. `expandNode` calls `getRelated` with
`has-children` and inserts results into the tree map.

### 3. Hierarchy Tree (`ExplorerTree` + `ExplorerTreeNode`)

`ExplorerTree.vue` renders the search/filter input and the root-level nodes.
`ExplorerTreeNode.vue` is recursive — renders its children when expanded.

- Uses shadcn `Collapsible` for expand/collapse with chevron animation
- Icons: folder (`fa-folder`) for compositions, circle (`fa-circle`) for leaves
- Filter: client-side filter on `displayName` across loaded nodes
- Click: calls `store.selectNode(id)` which updates main panel + sidebar

### 4. Node Detail Sidebar (`NodeDetail`)

Right sidebar (w-96, border-l) matching existing pattern from Device.vue:

- Header: display name + type icon
- `SidebarDetail` items: Element ID, Type ID, Parent ID, Namespace URI
- Composition badge (Yes/No)
- Subscribe button at bottom (adds to monitor store)

### 5. Relationship Graph (`RelationshipGraph`)

Cytoscape.js loaded via dynamic `import()`. Renders in the top section of the
main panel.

- **Nodes**: i3X objects with `displayName` labels
- **Edges**: parent/child relationships with type labels
- **Layout**: `breadthfirst` (top-down hierarchy) or `concentric` (radial)
- **Depth slider**: Range input (1-3), triggers re-fetch on change
- **Depth loading strategy**: For each depth level, collect all node IDs at that
  level and make a single `POST /objects/related` bulk call. Total calls = depth
  count, not node count.
- **Interaction**: Click node -> `store.selectNode(id)`. Pan/zoom built-in.
- **Styling**: Selected node = primary blue. Parent nodes = amber border.
  Children = green border. Others = grey.

### 6. Current Value (`CurrentValue`)

Card with:

- Value display (formatted based on type — number, boolean, string, object)
- `QualityBadge` component: green dot for Good, yellow for Uncertain, grey for
  GoodNoData, red for Bad
- Timestamp (formatted with dayjs)
- Refresh button (re-fetches `GET /objects/:id/value`)
- For compositions (`isComposition: true`): table of `components` with
  elementId, value, quality, timestamp per row

### 7. History Panel (`HistoryPanel`)

Collapsible section below current value:

- **Time range presets**: Button group — 1h, 6h, 24h, 7d, Custom
- **Custom range**: Two date/time inputs (start, end)
- **Load History button**: Triggers `POST /objects/history`
- **ECharts rendering** (lazy-loaded via dynamic import):
  - `LineChart` for numeric data
  - `DataZoomSlider` at bottom for zoom/brush
  - `Tooltip` with crosshair
  - Quality colour-coding on data points
- **CSV export**: Button generates CSV from loaded data and triggers download
  via `Blob` + `URL.createObjectURL` + click
- **Composition guard**: Shows "Select a leaf metric to view history" message
  when a composition node is selected

### 8. Monitor Store (`useMonitorStore`)

Pinia store managing subscriptions and live data:

```
State:
  - subscriptionId: string | null
  - clientId: string (generated UUID)
  - items: Map<elementId, { displayName, value, quality, timestamp, trend[] }>
  - newCount: number (increments when dialog closed + new data arrives)
  - dialogOpen: boolean
  - streaming: boolean

Actions:
  - subscribe(elementId, displayName)
  - unsubscribe(elementId)
  - unsubscribeAll()
  - startStream()
  - stopStream()
  - openDialog() — resets newCount to 0
  - closeDialog() — prompts if items exist? No — just closes viewport
```

SSE stream managed via `@microsoft/fetch-event-source`. On each event:
1. Parse `data` JSON array
2. For each item, update `items` map with new value/quality/timestamp
3. Append to `trend[]` (capped at 60 points)
4. If `!dialogOpen`, increment `newCount`

### 9. Monitor Button + Dialog (`MonitorButton` + `MonitorDialog`)

**MonitorButton**: In the navbar, left of SidebarTrigger. Shows monitor icon
(`fa-eye`) with a red badge overlay showing `newCount` when > 0.

**MonitorDialog**: Uses shadcn `Sheet` (side="right") for a slide-over panel.
Contains a scrollable list of monitor cards, each with:

- Card header: display name + quality badge + unsubscribe button
- Card body: current value + timestamp
- Card footer: ECharts sparkline (mini line chart, 120x40px, no axes, last 60
  points from trend data)

### 10. Quality Badge (`QualityBadge`)

Shared component used in CurrentValue, MonitorDialog, and HistoryPanel:

```vue
<Badge :variant="qualityVariant">{{ quality }}</Badge>
```

Mapping: Good = green/default, Uncertain = yellow/warning, GoodNoData = grey/secondary,
Bad = red/destructive.

## Data Flow

```
User clicks tree node
  -> store.selectNode(id)
  -> Triggers: NodeDetail re-renders, RelationshipGraph re-fetches,
     CurrentValue fetches GET /objects/:id/value

User clicks "Load History"
  -> POST /objects/history with selected time range
  -> ECharts renders result

User clicks "Subscribe"
  -> monitorStore.subscribe(elementId)
  -> If first subscription: POST /subscriptions, POST /subscriptions/register,
     POST /subscriptions/stream (SSE)
  -> If existing subscription: POST /subscriptions/register (add to existing)
  -> SSE events update monitorStore.items in real-time

User closes browser tab
  -> beforeunload: prompt if monitors active
  -> POST /subscriptions/delete (best-effort, server TTL cleans up)
```

## Routing & Navigation

Add to `main.js`:
```js
{
  path: '/explorer',
  component: () => import('@pages/Explorer/Explorer.vue'),
  meta: { name: 'Explorer', icon: 'compass' }
}
```

Add to Nav.vue `sidebarNavItems` array after Home:
```js
{ title: 'Explorer', href: '/explorer', icon: 'compass', auth: true }
```

## New Dependencies

| Package | Version | Purpose |
|---|---|---|
| `cytoscape` | ^3.30 | Relationship graph |
| `echarts` | ^5.5 | Charts (tree-shaken) |
| `vue-echarts` | ^7 | Vue 3 ECharts wrapper |
| `@microsoft/fetch-event-source` | ^2.0 | POST-based SSE |

All lazy-loaded via dynamic `import()` — only fetched when Explorer page or
MonitorDialog is opened.

## Environment Configuration

```
# .env / .env.example
I3X_BASE_URL=http://localhost:8080/v1
```

Accessed via `import.meta.env.I3X_BASE_URL` in `useI3xClient`.

## Spec Compliance

All API usage stays within i3X v0.1.0 spec boundaries:
- No custom query parameters
- No extended response fields
- Depth traversal via multiple standard `related` calls
- Standard subscription lifecycle (create -> register -> stream/sync -> delete)
