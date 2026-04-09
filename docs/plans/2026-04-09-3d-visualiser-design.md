# 3D Network Cosmos Visualiser - Design

A 3D ambient visualisation of the Factory+ / i3X object hierarchy, built
into acs-admin as a new page. Shows the full device topology as a
network cosmos with live data flow, quality-driven colour coding, and
sparkline history charts on camera approach.

## Context

The existing acs-visualiser is a standalone vanilla JS canvas app
connecting directly to MQTT/Sparkplug. This replacement:

- Lives inside acs-admin (auth, i3X client, Vue/Pinia already available)
- Uses the i3X REST API instead of raw Sparkplug
- Renders in 3D with Three.js for showstopper visual impact
- Targets trade shows, control room displays, and stakeholder demos

## Data Architecture

**Hierarchy loading** (on mount):
- `getObjects({ root: true })` for roots, then recursively
  `getRelated(id, 'i3x:rel:has-children')` to build the full tree
- Stored in `useVisualiserStore` Pinia store as a flat Map keyed by
  elementId with parent/child links
- Structure is static after initial load. Future: i3X structural change
  notifications (tracked in `acs-i3x/docs/spec-proposals.md` SP1)

**Live values** (continuous):
- i3X SSE subscription for all leaf metric IDs
- Updates streamed into store; Three.js reads current values each frame
- Tracks quality (Good/Bad/Uncertain), staleness from timestamp age
- Drives node colour and pulse rate

**History** (on camera approach):
- When camera nears a leaf node, fetch
  `getHistory(elementId, now - 60s, now)` once
- Cache history, append live SSE values to the tail so sparkline becomes
  a live-updating chart
- Discard cached history when camera moves away (memory efficiency)

## Scene Design

**Hierarchy as 3D space**:
- Root objects at the centre as large glowing orbs
- Children radiate outward in concentric shells
- Each level gets distinct size and visual treatment
- Connections as thin glowing lines between parent and child
- Force-directed layout with hierarchy constraints

**Node visuals by type**:
- Root/Site: large glowing spheres with bloom (radius 3.0)
- Area/WorkCenter: medium spheres (radius 1.5)
- Devices: smaller spheres, colour-coded by quality (radius 0.8)
- Leaf metrics: tiny particles orbiting parent (radius 0.2)
- All nodes use InstancedMesh for performance

**Data flow visualisation**:
- SSE value arrivals emit a particle travelling from leaf up to root
- Pulse colour matches quality state
- Nodes brighten briefly on update, creating a twinkling effect

**Ambient camera**:
- Slow auto-orbit (~5 min per rotation)
- Gentle drift in/out (60-120% of default distance)
- Every 30-45s, sweeps into a random device cluster (5s ease in,
  8-10s hold, 5s ease out)
- Cubic ease-in-out on all transitions

**Level of detail** (camera distance to node):
- < 40 units: labels appear
- < 15 units: sparklines appear (triggers history fetch)
- > 20 units: sparklines dispose (hysteresis)

**Post-processing**:
- Bloom/glow on emissive materials
- Background: #0a0a1a (near-black, blue tint)
- Optional subtle star-field for depth

## Colour Palette

| State       | Colour    |
|-------------|-----------|
| Good        | #009FE3   |
| Uncertain   | #F5A623   |
| Bad/offline | #F24B5B   |
| Stale       | #888888   |
| Edges       | #1a2a4a   |
| Background  | #0a0a1a   |

## Technical Architecture

**New files in acs-admin/src**:

```
pages/Visualiser/
  Visualiser.vue            Vue page, owns canvas ref, mounts/unmounts scene

store/
  useVisualiserStore.js     Pinia store: tree, SSE, values, history cache

lib/visualiser/
  scene.js                  Scene, renderer, camera, post-processing, resize
  graph.js                  3D layout algorithm from hierarchy
  nodes.js                  InstancedMesh per node type, colour/size updates
  edges.js                  Line geometry for connections
  particles.js              Data flow pulse particles (pooled, recycled)
  camera.js                 Auto-orbit, drift, sweep-to-node with easing
  sparklines.js             History chart geometry near leaf nodes
  lod.js                    Level-of-detail: camera distance triggers
  constants.js              Colours, sizes, speeds, thresholds
```

**Data flow**:

```
useI3xClient (existing composable)
  -> useVisualiserStore (Pinia)
       loads tree, manages SSE, caches values/history
  -> Visualiser.vue
       onMounted: creates scene, starts render loop
       watches store for tree rebuild
       onUnmounted: disposes scene, cleans up SSE
  -> scene.js render loop (rAF)
       reads store each frame for colour/pulse updates
       updates camera, particles, LOD
```

**Routing**: `/visualiser` route in main.js with nav entry.

**Dependencies**: `three` (Three.js). Post-processing from
`three/examples/jsm/postprocessing` (bundled with Three.js).

**Performance**:
- InstancedMesh: one draw call per node type
- BufferGeometry: single geometry for all edges
- Object pool: 200 pulse particles, recycled
- Sparklines: created/disposed on demand (only near camera)
- No per-frame allocations in render loop

## Pulse Particles

- Pool: 200 (recycled on completion)
- Speed: leaf to root in ~2s
- Size: 0.15, fades to 0 over lifetime
- On arrival: target node brightens for 0.3s

## Sparklines

- Line geometry floating beside leaf node
- ~4 x 2 scene units
- 60s history + live SSE tail
- No axis labels (ambient display)
- Line colour follows quality state

## Future / Out of Scope

- Interactive mode (click, search, filter) - not in this iteration
- Structural change notifications from i3X - pending spec proposal SP1
- MQTT-based animation for devices coming online - needs upstream work
