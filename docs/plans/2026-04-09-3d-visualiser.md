# 3D Network Cosmos Visualiser Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Build a Three.js ambient 3D visualisation of the i3X object hierarchy inside acs-admin, showing live data flow, quality-driven colours, and sparkline history on camera approach.

**Architecture:** New `/visualiser` route in acs-admin using auto-fullscreen. A Pinia store (`useVisualiserStore`) loads the full i3X tree and manages SSE subscriptions. A set of plain JS modules under `lib/visualiser/` handle all Three.js rendering. Vue owns the lifecycle; Three.js owns the canvas.

**Tech Stack:** Vue 3, Pinia, Three.js, existing useI3xClient/useI3xSSE composables

**Design doc:** `docs/plans/2026-04-09-3d-visualiser-design.md`

---

### Task 0: Install Three.js, create route and empty page

**Files:**
- Modify: `acs-admin/package.json` (add `three` dependency)
- Create: `acs-admin/src/pages/Visualiser/Visualiser.vue`
- Modify: `acs-admin/src/main.js:34-155` (add route)
- Modify: `acs-admin/src/components/Nav/Nav.vue:18-67` (add nav item)

**Step 1: Install Three.js**

```bash
cd acs-admin && npm install three
```

**Step 2: Create empty Visualiser page**

Create `acs-admin/src/pages/Visualiser/Visualiser.vue`:

```vue
<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useLayoutStore } from '@store/layoutStore.js'

const canvas = ref(null)
const layout = useLayoutStore()

onMounted(() => {
  layout.toggleFullscreen(true)
})

onBeforeUnmount(() => {
  layout.toggleFullscreen(false)
})
</script>

<template>
  <div class="fixed inset-0 bg-[#0a0a1a]">
    <canvas ref="canvas" class="w-full h-full" />
  </div>
</template>
```

**Step 3: Add route to main.js**

Add after the `/explorer` route block (after line 49 in `main.js`):

```javascript
{
  path: '/visualiser',
  component: () => import('@pages/Visualiser/Visualiser.vue'),
  meta: {
    name: 'Visualiser',
    icon: 'cube',
  },
},
```

**Step 4: Add nav item to Nav.vue**

Add after the Explorer entry in `sidebarNavItems`:

```javascript
{
    title: 'Visualiser',
    href: '/visualiser',
    icon: 'cube',
    auth: true
},
```

**Step 5: Verify**

Run `cd acs-admin && npm run dev`. Navigate to `/#/visualiser`. Should see a
full-screen dark background with no sidebar/header. Escape key exits
fullscreen. Nav item visible in sidebar.

**Step 6: Commit**

```bash
git add acs-admin/package.json acs-admin/package-lock.json \
  acs-admin/src/pages/Visualiser/Visualiser.vue \
  acs-admin/src/main.js acs-admin/src/components/Nav/Nav.vue
git commit -m "Add empty 3D visualiser page with Three.js dependency"
```

---

### Task 1: Scene scaffolding - renderer, camera, post-processing

**Files:**
- Create: `acs-admin/src/lib/visualiser/constants.js`
- Create: `acs-admin/src/lib/visualiser/scene.js`
- Modify: `acs-admin/src/pages/Visualiser/Visualiser.vue`

**Step 1: Create constants.js**

Create `acs-admin/src/lib/visualiser/constants.js`:

```javascript
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

// Colours
export const BG_COLOUR = 0x0a0a1a
export const COLOUR_GOOD = 0x009fe3
export const COLOUR_UNCERTAIN = 0xf5a623
export const COLOUR_BAD = 0xf24b5b
export const COLOUR_STALE = 0x888888
export const COLOUR_EDGE = 0x1a2a4a

// Node radii
export const RADIUS_ROOT = 3.0
export const RADIUS_AREA = 1.5
export const RADIUS_DEVICE = 0.8
export const RADIUS_LEAF = 0.2

// Camera
export const ORBIT_SPEED = 0.02          // rad/s
export const DRIFT_MIN = 0.6             // min distance multiplier
export const DRIFT_MAX = 1.2             // max distance multiplier
export const DRIFT_PERIOD = 60           // seconds per drift cycle
export const SWEEP_INTERVAL_MIN = 30     // seconds between sweeps
export const SWEEP_INTERVAL_MAX = 45
export const SWEEP_EASE_IN = 5           // seconds
export const SWEEP_HOLD = 8
export const SWEEP_EASE_OUT = 5

// LOD thresholds (distance from camera to node)
export const LOD_LABEL = 40
export const LOD_SPARKLINE_SHOW = 15
export const LOD_SPARKLINE_HIDE = 20     // hysteresis

// Particles
export const PARTICLE_POOL_SIZE = 200
export const PARTICLE_SPEED = 2.0        // seconds leaf-to-root
export const PARTICLE_SIZE = 0.15

// Sparklines
export const SPARKLINE_WIDTH = 4
export const SPARKLINE_HEIGHT = 2
export const SPARKLINE_HISTORY_SECS = 60
```

**Step 2: Create scene.js**

Create `acs-admin/src/lib/visualiser/scene.js`:

```javascript
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { BG_COLOUR } from './constants.js'

export function createScene (canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(canvas.clientWidth, canvas.clientHeight)
  renderer.setClearColor(BG_COLOUR)

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(BG_COLOUR, 0.003)

  const camera = new THREE.PerspectiveCamera(
    60,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    2000,
  )
  camera.position.set(0, 40, 100)
  camera.lookAt(0, 0, 0)

  // Ambient light so nodes are visible from all angles
  scene.add(new THREE.AmbientLight(0xffffff, 0.4))

  // Point light at centre for glow effect
  const centreLight = new THREE.PointLight(0x009fe3, 1, 200)
  centreLight.position.set(0, 0, 0)
  scene.add(centreLight)

  // Post-processing: bloom for the cosmos glow
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
    1.2,   // strength
    0.4,   // radius
    0.85,  // threshold
  )
  composer.addPass(bloom)

  // Star field background
  const starGeo = new THREE.BufferGeometry()
  const starCount = 2000
  const starPositions = new Float32Array(starCount * 3)
  for (let i = 0; i < starCount * 3; i++) {
    starPositions[i] = (Math.random() - 0.5) * 1500
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.3, transparent: true, opacity: 0.6 })
  scene.add(new THREE.Points(starGeo, starMat))

  // Resize handler
  function onResize () {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    composer.setSize(w, h)
  }

  // Render loop
  let frameId = null
  let lastTime = performance.now()
  const callbacks = []

  function animate (time) {
    frameId = requestAnimationFrame(animate)
    const dt = (time - lastTime) / 1000
    lastTime = time
    for (const cb of callbacks) cb(dt, time / 1000)
    composer.render()
  }

  function start () {
    window.addEventListener('resize', onResize)
    onResize()
    frameId = requestAnimationFrame(animate)
  }

  function dispose () {
    if (frameId != null) cancelAnimationFrame(frameId)
    window.removeEventListener('resize', onResize)
    renderer.dispose()
    composer.dispose()
  }

  function onUpdate (cb) {
    callbacks.push(cb)
  }

  return { scene, camera, renderer, composer, start, dispose, onUpdate }
}
```

**Step 3: Wire scene into Visualiser.vue**

Update `Visualiser.vue` to create and run the scene:

```vue
<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useLayoutStore } from '@store/layoutStore.js'
import { createScene } from '@/lib/visualiser/scene.js'

const canvas = ref(null)
const layout = useLayoutStore()
let sceneCtx = null

onMounted(() => {
  layout.toggleFullscreen(true)
  sceneCtx = createScene(canvas.value)
  sceneCtx.start()
})

onBeforeUnmount(() => {
  if (sceneCtx) sceneCtx.dispose()
  layout.toggleFullscreen(false)
})
</script>

<template>
  <div class="fixed inset-0 bg-[#0a0a1a]">
    <canvas ref="canvas" class="w-full h-full block" />
  </div>
</template>
```

**Step 4: Verify**

Run dev server. Navigate to `/#/visualiser`. Should see:
- Dark background with subtle star field
- Bloom glow effect active
- Blue point light glow at centre
- Canvas resizes with window
- Escape exits fullscreen, sidebar reappears

**Step 5: Commit**

```bash
git add acs-admin/src/lib/visualiser/constants.js \
  acs-admin/src/lib/visualiser/scene.js \
  acs-admin/src/pages/Visualiser/Visualiser.vue
git commit -m "Add Three.js scene with bloom post-processing and star field"
```

---

### Task 2: Pinia store - load i3X tree

**Files:**
- Create: `acs-admin/src/store/useVisualiserStore.js`
- Modify: `acs-admin/src/pages/Visualiser/Visualiser.vue`

**Step 1: Create useVisualiserStore.js**

Follow the same patterns as `useExplorerStore.js` and `useMonitorStore.js`.
The store loads the full tree recursively on init.

Create `acs-admin/src/store/useVisualiserStore.js`:

```javascript
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { defineStore } from 'pinia'
import { useI3xClient } from '@composables/useI3xClient.js'
import { openI3xStream } from '@composables/useI3xSSE.js'
import { SPARKLINE_HISTORY_SECS } from '@/lib/visualiser/constants.js'

function generateClientId () {
  return 'acs-vis-' + crypto.randomUUID()
}

export const useVisualiserStore = defineStore('visualiser', {
  state: () => ({
    // Tree structure
    nodes: new Map(),       // elementId -> { node, parentId, childIds, depth }
    rootIds: [],
    loading: false,
    loaded: false,

    // Live values from SSE
    values: new Map(),      // elementId -> { value, quality, timestamp }
    clientId: generateClientId(),
    subscriptionId: null,
    streaming: false,
    _streamController: null,

    // History cache (only for nodes near camera)
    history: new Map(),     // elementId -> { points: [], fetching: false, lastFetch: 0 }
  }),

  getters: {
    leafIds (state) {
      const leaves = []
      for (const [id, entry] of state.nodes) {
        if (entry.childIds.length === 0) leaves.push(id)
      }
      return leaves
    },
  },

  actions: {
    async loadTree () {
      if (this.loading) return
      this.loading = true
      try {
        const i3x = useI3xClient()
        const roots = await i3x.getObjects({ root: true })

        this.nodes.clear()
        this.rootIds = []

        for (const obj of roots) {
          this.nodes.set(obj.elementId, {
            node: obj,
            parentId: null,
            childIds: [],
            depth: 0,
          })
          this.rootIds.push(obj.elementId)
        }

        // Recursively load all children
        await this._loadChildrenRecursive(this.rootIds, 1)
        this.loaded = true
      } finally {
        this.loading = false
      }
    },

    async _loadChildrenRecursive (parentIds, depth) {
      if (parentIds.length === 0) return

      const i3x = useI3xClient()
      const nextLevel = []

      // Load children for all parents at this depth in parallel
      const results = await Promise.all(
        parentIds.map(async (parentId) => {
          try {
            const children = await i3x.getRelated(parentId, 'i3x:rel:has-children')
            return { parentId, children }
          } catch {
            return { parentId, children: [] }
          }
        }),
      )

      for (const { parentId, children } of results) {
        const parent = this.nodes.get(parentId)
        if (!parent) continue

        const childIds = []
        for (const child of children) {
          childIds.push(child.elementId)
          if (!this.nodes.has(child.elementId)) {
            this.nodes.set(child.elementId, {
              node: child,
              parentId,
              childIds: [],
              depth,
            })
            nextLevel.push(child.elementId)
          }
        }
        parent.childIds = childIds
      }

      // Recurse to next level
      if (nextLevel.length > 0) {
        await this._loadChildrenRecursive(nextLevel, depth + 1)
      }
    },

    // --- SSE Subscriptions ---

    async startStreaming () {
      const leaves = this.leafIds
      if (leaves.length === 0) return

      const i3x = useI3xClient()

      const result = await i3x.createSubscription(this.clientId, 'ACS Visualiser')
      this.subscriptionId = result.subscriptionId

      // Register in batches of 100 to avoid huge payloads
      for (let i = 0; i < leaves.length; i += 100) {
        const batch = leaves.slice(i, i + 100)
        await i3x.registerItems(this.clientId, this.subscriptionId, batch)
      }

      this.streaming = true
      this._streamController = openI3xStream(
        i3x.baseUrl,
        this.clientId,
        this.subscriptionId,
        (items) => this._handleStreamData(items),
        () => { this.streaming = false },
      )
    },

    _handleStreamData (items) {
      for (const item of items) {
        this.values.set(item.elementId, {
          value: item.value,
          quality: item.quality,
          timestamp: item.timestamp,
        })

        // Append to history if we have an active cache for this node
        const hist = this.history.get(item.elementId)
        if (hist && typeof item.value === 'number') {
          hist.points.push({
            value: item.value,
            timestamp: item.timestamp,
          })
          // Trim old points beyond the sparkline window
          const cutoff = Date.now() - (SPARKLINE_HISTORY_SECS + 10) * 1000
          while (hist.points.length > 0 && new Date(hist.points[0].timestamp).getTime() < cutoff) {
            hist.points.shift()
          }
        }
      }
    },

    // --- History ---

    async fetchHistory (elementId) {
      if (this.history.has(elementId)) return
      const entry = { points: [], fetching: true, lastFetch: Date.now() }
      this.history.set(elementId, entry)

      try {
        const i3x = useI3xClient()
        const end = new Date()
        const start = new Date(end.getTime() - SPARKLINE_HISTORY_SECS * 1000)
        const result = await i3x.getHistory(
          elementId,
          start.toISOString(),
          end.toISOString(),
        )
        if (result?.values) {
          entry.points = result.values
            .filter(v => typeof v.value === 'number')
            .map(v => ({ value: v.value, timestamp: v.timestamp }))
        }
      } catch {
        // History unavailable - sparkline will just show live data
      } finally {
        entry.fetching = false
      }
    },

    evictHistory (elementId) {
      this.history.delete(elementId)
    },

    // --- Cleanup ---

    async cleanup () {
      if (this._streamController) {
        this._streamController.close()
        this._streamController = null
      }
      this.streaming = false

      if (this.subscriptionId) {
        const i3x = useI3xClient()
        try {
          await i3x.deleteSubscription(this.clientId, [this.subscriptionId])
        } catch {
          // Server TTL will clean up
        }
        this.subscriptionId = null
      }

      this.values.clear()
      this.history.clear()
    },
  },
})
```

**Step 2: Wire store into Visualiser.vue**

Update the `onMounted` in `Visualiser.vue` to load the tree:

```vue
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useLayoutStore } from '@store/layoutStore.js'
import { useVisualiserStore } from '@store/useVisualiserStore.js'
import { createScene } from '@/lib/visualiser/scene.js'

const canvas = ref(null)
const layout = useLayoutStore()
const store = useVisualiserStore()
let sceneCtx = null

onMounted(async () => {
  layout.toggleFullscreen(true)
  sceneCtx = createScene(canvas.value)
  sceneCtx.start()

  await store.loadTree()
  console.log(`Visualiser: loaded ${store.nodes.size} nodes, ${store.leafIds.length} leaves`)

  await store.startStreaming()
  console.log('Visualiser: SSE streaming started')
})

onBeforeUnmount(async () => {
  if (sceneCtx) sceneCtx.dispose()
  await store.cleanup()
  layout.toggleFullscreen(false)
})
</script>

<template>
  <div class="fixed inset-0 bg-[#0a0a1a]">
    <canvas ref="canvas" class="w-full h-full block" />
  </div>
</template>
```

**Step 3: Verify**

Run dev server. Navigate to `/#/visualiser`. Open browser console. Should see:
- "Visualiser: loaded N nodes, M leaves" with reasonable numbers
- "Visualiser: SSE streaming started"
- No errors in console
- Scene still renders (dark background + stars)

**Step 4: Commit**

```bash
git add acs-admin/src/store/useVisualiserStore.js \
  acs-admin/src/pages/Visualiser/Visualiser.vue
git commit -m "Add visualiser Pinia store with i3X tree loading and SSE subscriptions"
```

---

### Task 3: Graph layout algorithm

**Files:**
- Create: `acs-admin/src/lib/visualiser/graph.js`

**Step 1: Create graph.js**

This module takes the flat node Map from the store and computes 3D
positions. Uses a hierarchical radial layout: roots at centre, children
radiate outward in concentric spherical shells. Nodes at each level are
distributed evenly using a golden-angle spiral on a sphere surface.

Create `acs-admin/src/lib/visualiser/graph.js`:

```javascript
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'

// Golden angle in radians for even sphere distribution
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

// Distance between hierarchy shells
const SHELL_SPACING = 20

// Jitter to avoid perfect overlaps
const JITTER = 0.5

/**
 * Compute 3D positions for all nodes in the hierarchy.
 *
 * @param {Map} nodes - store.nodes Map (elementId -> { parentId, childIds, depth })
 * @param {string[]} rootIds - store.rootIds
 * @returns {Map<string, THREE.Vector3>} elementId -> position
 */
export function computeLayout (nodes, rootIds) {
  const positions = new Map()

  if (rootIds.length === 0) return positions

  // Place roots at the centre, spread slightly
  placeGroup(rootIds, new THREE.Vector3(0, 0, 0), 5, positions)

  // BFS outward, placing children around their parent
  const queue = [...rootIds]

  while (queue.length > 0) {
    const parentId = queue.shift()
    const parent = nodes.get(parentId)
    if (!parent || parent.childIds.length === 0) continue

    const parentPos = positions.get(parentId)
    const radius = SHELL_SPACING * (1 - 0.15 * Math.min(parent.depth, 4))

    placeGroup(parent.childIds, parentPos, radius, positions)

    for (const childId of parent.childIds) {
      queue.push(childId)
    }
  }

  return positions
}

/**
 * Distribute a group of node IDs on a sphere around a centre point.
 */
function placeGroup (ids, centre, radius, positions) {
  const count = ids.length

  for (let i = 0; i < count; i++) {
    const id = ids[i]
    if (positions.has(id)) continue

    if (count === 1) {
      // Single child: offset slightly from parent
      positions.set(id, new THREE.Vector3(
        centre.x + radius * 0.5,
        centre.y,
        centre.z,
      ))
      continue
    }

    // Fibonacci sphere distribution
    const y = 1 - (2 * i / (count - 1))  // -1 to 1
    const radiusAtY = Math.sqrt(1 - y * y)
    const theta = GOLDEN_ANGLE * i

    const x = radiusAtY * Math.cos(theta)
    const z = radiusAtY * Math.sin(theta)

    // Add small jitter to avoid exact overlaps
    const jx = (Math.random() - 0.5) * JITTER
    const jy = (Math.random() - 0.5) * JITTER
    const jz = (Math.random() - 0.5) * JITTER

    positions.set(id, new THREE.Vector3(
      centre.x + x * radius + jx,
      centre.y + y * radius + jy,
      centre.z + z * radius + jz,
    ))
  }
}
```

**Step 2: Verify**

This is a pure function. Verify by temporarily logging in `Visualiser.vue`
after tree loads:

```javascript
import { computeLayout } from '@/lib/visualiser/graph.js'
// ... in onMounted after loadTree:
const positions = computeLayout(store.nodes, store.rootIds)
console.log(`Layout: ${positions.size} positions computed`)
```

Check console shows positions for all nodes. Remove temporary log after.

**Step 3: Commit**

```bash
git add acs-admin/src/lib/visualiser/graph.js
git commit -m "Add hierarchical radial layout algorithm for 3D node positioning"
```

---

### Task 4: Node rendering with InstancedMesh

**Files:**
- Create: `acs-admin/src/lib/visualiser/nodes.js`
- Modify: `acs-admin/src/pages/Visualiser/Visualiser.vue`

**Step 1: Create nodes.js**

Uses one InstancedMesh per node type (root, area, device, leaf). Each
instance has its own colour and transform. Colours update each frame
based on quality state from the store.

Create `acs-admin/src/lib/visualiser/nodes.js`:

```javascript
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import {
  RADIUS_ROOT, RADIUS_AREA, RADIUS_DEVICE, RADIUS_LEAF,
  COLOUR_GOOD, COLOUR_UNCERTAIN, COLOUR_BAD, COLOUR_STALE,
} from './constants.js'

const DEPTH_CONFIG = [
  { radius: RADIUS_ROOT, emissive: 0.8 },     // depth 0: root/enterprise
  { radius: RADIUS_AREA, emissive: 0.5 },      // depth 1: site/area
  { radius: RADIUS_AREA * 0.8, emissive: 0.4 },// depth 2: work centre
  { radius: RADIUS_DEVICE, emissive: 0.3 },    // depth 3: device
]
const LEAF_CONFIG = { radius: RADIUS_LEAF, emissive: 0.6 }

const QUALITY_COLOURS = {
  Good: new THREE.Color(COLOUR_GOOD),
  GoodNoData: new THREE.Color(COLOUR_GOOD).multiplyScalar(0.5),
  Uncertain: new THREE.Color(COLOUR_UNCERTAIN),
  Bad: new THREE.Color(COLOUR_BAD),
}
const DEFAULT_COLOUR = new THREE.Color(COLOUR_STALE)

/**
 * Create and manage instanced node meshes.
 */
export function createNodes (scene) {
  const meshes = []
  const instanceMap = new Map()  // elementId -> { mesh, index }

  // Shared geometry
  const sphere = new THREE.SphereGeometry(1, 16, 12)
  const dummy = new THREE.Object3D()
  const colour = new THREE.Color()

  function build (storeNodes, positions) {
    // Remove old meshes
    for (const m of meshes) {
      scene.remove(m)
      m.dispose()
    }
    meshes.length = 0
    instanceMap.clear()

    // Group nodes by depth bucket
    const groups = new Map()  // depth -> [{ id, pos }]

    for (const [id, entry] of storeNodes) {
      const pos = positions.get(id)
      if (!pos) continue

      const isLeaf = entry.childIds.length === 0
      const key = isLeaf ? 'leaf' : Math.min(entry.depth, 3)

      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push({ id, pos })
    }

    // Create one InstancedMesh per group
    for (const [key, items] of groups) {
      const config = key === 'leaf' ? LEAF_CONFIG : DEPTH_CONFIG[key]
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: COLOUR_GOOD,
        emissiveIntensity: config.emissive,
        transparent: true,
        opacity: 0.9,
      })

      const mesh = new THREE.InstancedMesh(sphere, material, items.length)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

      // Per-instance colour
      const colours = new Float32Array(items.length * 3)
      DEFAULT_COLOUR.toArray(colours, 0)
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colours, 3)

      for (let i = 0; i < items.length; i++) {
        const { id, pos } = items[i]
        dummy.position.copy(pos)
        dummy.scale.setScalar(config.radius)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        mesh.setColorAt(i, DEFAULT_COLOUR)

        instanceMap.set(id, { mesh, index: i })
      }

      mesh.instanceMatrix.needsUpdate = true
      mesh.instanceColor.needsUpdate = true
      scene.add(mesh)
      meshes.push(mesh)
    }
  }

  // Brightness flash tracking
  const flashes = new Map()  // elementId -> remaining seconds

  function update (dt, storeValues) {
    // Decay flashes
    for (const [id, remaining] of flashes) {
      const next = remaining - dt
      if (next <= 0) {
        flashes.delete(id)
      } else {
        flashes.set(id, next)
      }
    }

    // Update colours from values
    for (const [elementId, vqt] of storeValues) {
      const inst = instanceMap.get(elementId)
      if (!inst) continue

      const base = QUALITY_COLOURS[vqt.quality] ?? DEFAULT_COLOUR
      colour.copy(base)

      // Brighten on recent update
      const flash = flashes.get(elementId)
      if (flash) {
        colour.lerp(new THREE.Color(0xffffff), flash)
      }

      inst.mesh.setColorAt(inst.index, colour)
      inst.mesh.instanceColor.needsUpdate = true
    }
  }

  function flash (elementId) {
    flashes.set(elementId, 0.3)
  }

  function dispose () {
    for (const m of meshes) {
      scene.remove(m)
      m.geometry.dispose()
      m.material.dispose()
    }
  }

  return { build, update, flash, dispose, instanceMap }
}
```

**Step 2: Wire into Visualiser.vue**

Update `Visualiser.vue` to build nodes after tree loads:

```vue
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useLayoutStore } from '@store/layoutStore.js'
import { useVisualiserStore } from '@store/useVisualiserStore.js'
import { createScene } from '@/lib/visualiser/scene.js'
import { computeLayout } from '@/lib/visualiser/graph.js'
import { createNodes } from '@/lib/visualiser/nodes.js'

const canvas = ref(null)
const layout = useLayoutStore()
const store = useVisualiserStore()
let sceneCtx = null
let nodesCtx = null
let positions = null

onMounted(async () => {
  layout.toggleFullscreen(true)
  sceneCtx = createScene(canvas.value)

  await store.loadTree()
  positions = computeLayout(store.nodes, store.rootIds)

  nodesCtx = createNodes(sceneCtx.scene)
  nodesCtx.build(store.nodes, positions)

  sceneCtx.onUpdate((dt) => {
    nodesCtx.update(dt, store.values)
  })

  sceneCtx.start()
  await store.startStreaming()
})

onBeforeUnmount(async () => {
  if (nodesCtx) nodesCtx.dispose()
  if (sceneCtx) sceneCtx.dispose()
  await store.cleanup()
  layout.toggleFullscreen(false)
})
</script>

<template>
  <div class="fixed inset-0 bg-[#0a0a1a]">
    <canvas ref="canvas" class="w-full h-full block" />
  </div>
</template>
```

**Step 3: Verify**

Run dev server. Navigate to `/#/visualiser`. Should see:
- Glowing spheres of varying sizes arranged in a radial pattern
- Larger bright orbs at centre (roots), smaller ones radiating outward
- Bloom glow on all nodes
- Nodes start grey, then colour as SSE values arrive
- Star field visible behind

**Step 4: Commit**

```bash
git add acs-admin/src/lib/visualiser/nodes.js \
  acs-admin/src/pages/Visualiser/Visualiser.vue
git commit -m "Add instanced node rendering with quality-driven colours and flash"
```

---

### Task 5: Edge rendering

**Files:**
- Create: `acs-admin/src/lib/visualiser/edges.js`
- Modify: `acs-admin/src/pages/Visualiser/Visualiser.vue`

**Step 1: Create edges.js**

Renders all parent-child connections as a single line geometry.

Create `acs-admin/src/lib/visualiser/edges.js`:

```javascript
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import { COLOUR_EDGE } from './constants.js'

export function createEdges (scene) {
  let lines = null

  function build (storeNodes, positions) {
    if (lines) {
      scene.remove(lines)
      lines.geometry.dispose()
      lines.material.dispose()
    }

    const points = []

    for (const [id, entry] of storeNodes) {
      if (!entry.parentId) continue
      const from = positions.get(entry.parentId)
      const to = positions.get(id)
      if (!from || !to) continue
      points.push(from.x, from.y, from.z)
      points.push(to.x, to.y, to.z)
    }

    if (points.length === 0) return

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))

    const material = new THREE.LineBasicMaterial({
      color: COLOUR_EDGE,
      transparent: true,
      opacity: 0.4,
    })

    lines = new THREE.LineSegments(geometry, material)
    scene.add(lines)
  }

  function dispose () {
    if (lines) {
      scene.remove(lines)
      lines.geometry.dispose()
      lines.material.dispose()
    }
  }

  return { build, dispose }
}
```

**Step 2: Wire into Visualiser.vue**

Add edge creation after node creation:

```javascript
import { createEdges } from '@/lib/visualiser/edges.js'

// ... in onMounted, after nodesCtx.build():
let edgesCtx = null
edgesCtx = createEdges(sceneCtx.scene)
edgesCtx.build(store.nodes, positions)
```

Add to `onBeforeUnmount`: `if (edgesCtx) edgesCtx.dispose()`

**Step 3: Verify**

Run dev server. Should see thin dark blue lines connecting parent nodes to
children, forming a visible tree structure. Lines should be subtle, not
dominating the scene.

**Step 4: Commit**

```bash
git add acs-admin/src/lib/visualiser/edges.js \
  acs-admin/src/pages/Visualiser/Visualiser.vue
git commit -m "Add edge rendering for parent-child connections"
```

---

### Task 6: Ambient camera controller

**Files:**
- Create: `acs-admin/src/lib/visualiser/camera.js`
- Modify: `acs-admin/src/pages/Visualiser/Visualiser.vue`

**Step 1: Create camera.js**

Handles auto-orbit, gentle drift, and periodic sweep-to-node.

Create `acs-admin/src/lib/visualiser/camera.js`:

```javascript
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import {
  ORBIT_SPEED, DRIFT_MIN, DRIFT_MAX, DRIFT_PERIOD,
  SWEEP_INTERVAL_MIN, SWEEP_INTERVAL_MAX,
  SWEEP_EASE_IN, SWEEP_HOLD, SWEEP_EASE_OUT,
  LOD_SPARKLINE_SHOW,
} from './constants.js'

function easeInOutCubic (t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function randomRange (min, max) {
  return min + Math.random() * (max - min)
}

export function createCameraController (camera, positions) {
  const baseDistance = 100
  let angle = 0
  let elapsed = 0
  let nextSweep = randomRange(SWEEP_INTERVAL_MIN, SWEEP_INTERVAL_MAX)

  // Sweep state
  let sweeping = false
  let sweepTarget = null
  let sweepStartPos = new THREE.Vector3()
  let sweepStartLook = new THREE.Vector3()
  let sweepEndPos = new THREE.Vector3()
  let sweepEndLook = new THREE.Vector3()
  let sweepTime = 0
  let sweepPhase = 'idle'  // idle | ease-in | hold | ease-out
  let sweepPhaseDuration = 0

  // Current look target (for smooth interpolation)
  const lookTarget = new THREE.Vector3(0, 0, 0)

  function pickSweepTarget () {
    // Pick a random node that has children (a device cluster)
    const candidates = []
    for (const [id, pos] of positions) {
      candidates.push({ id, pos })
    }
    if (candidates.length === 0) return null
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  function startSweep () {
    const target = pickSweepTarget()
    if (!target) return

    sweepTarget = target
    sweeping = true
    sweepPhase = 'ease-in'
    sweepPhaseDuration = SWEEP_EASE_IN
    sweepTime = 0

    sweepStartPos.copy(camera.position)
    sweepStartLook.copy(lookTarget)

    // Position camera close to the target, offset slightly
    const offset = new THREE.Vector3(
      LOD_SPARKLINE_SHOW * 0.8,
      LOD_SPARKLINE_SHOW * 0.3,
      LOD_SPARKLINE_SHOW * 0.5,
    )
    sweepEndPos.copy(target.pos).add(offset)
    sweepEndLook.copy(target.pos)
  }

  function endSweep () {
    sweepPhase = 'ease-out'
    sweepPhaseDuration = SWEEP_EASE_OUT
    sweepTime = 0

    sweepStartPos.copy(camera.position)
    sweepStartLook.copy(lookTarget)

    // Return to orbit position
    const drift = DRIFT_MIN + (DRIFT_MAX - DRIFT_MIN) * 0.5
    const dist = baseDistance * drift
    sweepEndPos.set(
      Math.cos(angle) * dist,
      40,
      Math.sin(angle) * dist,
    )
    sweepEndLook.set(0, 0, 0)
  }

  function update (dt) {
    elapsed += dt

    if (sweeping) {
      sweepTime += dt
      const t = Math.min(sweepTime / sweepPhaseDuration, 1)
      const eased = easeInOutCubic(t)

      camera.position.lerpVectors(sweepStartPos, sweepEndPos, eased)
      lookTarget.lerpVectors(sweepStartLook, sweepEndLook, eased)
      camera.lookAt(lookTarget)

      if (t >= 1) {
        if (sweepPhase === 'ease-in') {
          sweepPhase = 'hold'
          sweepPhaseDuration = SWEEP_HOLD
          sweepTime = 0
        } else if (sweepPhase === 'hold') {
          endSweep()
        } else if (sweepPhase === 'ease-out') {
          sweeping = false
          nextSweep = randomRange(SWEEP_INTERVAL_MIN, SWEEP_INTERVAL_MAX)
        }
      }

      return
    }

    // Normal orbit
    angle += ORBIT_SPEED * dt

    const driftT = (Math.sin(elapsed * (2 * Math.PI / DRIFT_PERIOD)) + 1) / 2
    const drift = DRIFT_MIN + (DRIFT_MAX - DRIFT_MIN) * driftT
    const dist = baseDistance * drift

    camera.position.set(
      Math.cos(angle) * dist,
      30 + 10 * Math.sin(elapsed * 0.1),
      Math.sin(angle) * dist,
    )

    lookTarget.set(0, 0, 0)
    camera.lookAt(lookTarget)

    // Check if it's time for a sweep
    nextSweep -= dt
    if (nextSweep <= 0) {
      startSweep()
    }
  }

  /** Returns the position the camera is currently looking at. */
  function getLookTarget () {
    return lookTarget
  }

  return { update, getLookTarget }
}
```

**Step 2: Wire into Visualiser.vue**

Add after nodes/edges build:

```javascript
import { createCameraController } from '@/lib/visualiser/camera.js'

// ... in onMounted after edges:
const cameraCtrl = createCameraController(sceneCtx.camera, positions)

sceneCtx.onUpdate((dt) => {
  cameraCtrl.update(dt)
  nodesCtx.update(dt, store.values)
})
```

**Step 3: Verify**

Run dev server. Should see:
- Camera slowly orbiting the scene
- Gentle vertical drift
- Every 30-45s, camera sweeps into a random node cluster then pulls back
- Smooth easing on all transitions
- No jarring cuts or pops

**Step 4: Commit**

```bash
git add acs-admin/src/lib/visualiser/camera.js \
  acs-admin/src/pages/Visualiser/Visualiser.vue
git commit -m "Add ambient camera with auto-orbit, drift, and sweep-to-node"
```

---

### Task 7: Data flow pulse particles

**Files:**
- Create: `acs-admin/src/lib/visualiser/particles.js`
- Modify: `acs-admin/src/pages/Visualiser/Visualiser.vue`

**Step 1: Create particles.js**

Object-pooled particle system. When an SSE value arrives, a particle
spawns at the leaf and travels up the parent chain to the root.

Create `acs-admin/src/lib/visualiser/particles.js`:

```javascript
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import {
  PARTICLE_POOL_SIZE, PARTICLE_SPEED, PARTICLE_SIZE,
  COLOUR_GOOD, COLOUR_UNCERTAIN, COLOUR_BAD, COLOUR_STALE,
} from './constants.js'

const QUALITY_COLOURS = {
  Good: new THREE.Color(COLOUR_GOOD),
  GoodNoData: new THREE.Color(COLOUR_GOOD),
  Uncertain: new THREE.Color(COLOUR_UNCERTAIN),
  Bad: new THREE.Color(COLOUR_BAD),
}
const DEFAULT_COLOUR = new THREE.Color(COLOUR_STALE)

export function createParticles (scene) {
  // Pool of particle instances
  const pool = []
  let activeCount = 0

  // Use Points for rendering
  const geometry = new THREE.BufferGeometry()
  const posAttr = new Float32Array(PARTICLE_POOL_SIZE * 3)
  const colAttr = new Float32Array(PARTICLE_POOL_SIZE * 3)
  const sizeAttr = new Float32Array(PARTICLE_POOL_SIZE)

  geometry.setAttribute('position', new THREE.BufferAttribute(posAttr, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colAttr, 3))
  geometry.setAttribute('size', new THREE.BufferAttribute(sizeAttr, 1))
  geometry.setDrawRange(0, 0)

  const material = new THREE.PointsMaterial({
    size: PARTICLE_SIZE,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  })

  const points = new THREE.Points(geometry, material)
  scene.add(points)

  // Each particle: { path: [Vector3], pathIndex, progress, colour, alive }
  for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
    pool.push({ path: [], pathIndex: 0, progress: 0, colour: new THREE.Color(), alive: false })
  }

  /**
   * Emit a particle from a leaf node up to the root.
   * @param {string} elementId - the leaf that received a value
   * @param {string} quality - quality string
   * @param {Map} storeNodes - the node map
   * @param {Map} positions - the position map
   * @param {function} onNodeHit - called with elementId when particle reaches a node
   */
  function emit (elementId, quality, storeNodes, positions, onNodeHit) {
    // Find a dead particle
    let p = null
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      if (!pool[i].alive) { p = pool[i]; break }
    }
    if (!p) return  // Pool exhausted

    // Build path from leaf to root
    const path = []
    let current = elementId
    while (current) {
      const pos = positions.get(current)
      if (pos) path.push({ pos, id: current })
      const entry = storeNodes.get(current)
      current = entry?.parentId ?? null
    }

    if (path.length < 2) return

    p.path = path
    p.pathIndex = 0
    p.progress = 0
    p.colour.copy(QUALITY_COLOURS[quality] ?? DEFAULT_COLOUR)
    p.alive = true
    p._onNodeHit = onNodeHit
  }

  function update (dt) {
    activeCount = 0
    const segmentDuration = PARTICLE_SPEED / 5  // time per segment (approximate)

    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const p = pool[i]
      if (!p.alive) {
        // Hide inactive particles
        posAttr[i * 3] = 0
        posAttr[i * 3 + 1] = -9999
        posAttr[i * 3 + 2] = 0
        sizeAttr[i] = 0
        continue
      }

      const segCount = p.path.length - 1
      const totalDuration = PARTICLE_SPEED
      const segDuration = totalDuration / segCount

      p.progress += dt
      const segIndex = Math.floor(p.progress / segDuration)

      if (segIndex >= segCount) {
        p.alive = false
        sizeAttr[i] = 0
        continue
      }

      // Check if we just crossed into a new segment (hit a node)
      if (segIndex > p.pathIndex) {
        const hitNode = p.path[segIndex]
        if (hitNode && p._onNodeHit) p._onNodeHit(hitNode.id)
        p.pathIndex = segIndex
      }

      const segT = (p.progress - segIndex * segDuration) / segDuration
      const from = p.path[segIndex].pos
      const to = p.path[segIndex + 1].pos

      posAttr[i * 3] = from.x + (to.x - from.x) * segT
      posAttr[i * 3 + 1] = from.y + (to.y - from.y) * segT
      posAttr[i * 3 + 2] = from.z + (to.z - from.z) * segT

      // Fade out over lifetime
      const lifeT = p.progress / totalDuration
      const fade = 1 - lifeT
      colAttr[i * 3] = p.colour.r * fade
      colAttr[i * 3 + 1] = p.colour.g * fade
      colAttr[i * 3 + 2] = p.colour.b * fade

      sizeAttr[i] = PARTICLE_SIZE * fade

      activeCount++
    }

    geometry.attributes.position.needsUpdate = true
    geometry.attributes.color.needsUpdate = true
    geometry.attributes.size.needsUpdate = true
    geometry.setDrawRange(0, PARTICLE_POOL_SIZE)
  }

  function dispose () {
    scene.remove(points)
    geometry.dispose()
    material.dispose()
  }

  return { emit, update, dispose }
}
```

**Step 2: Wire into Visualiser.vue**

Track which values have already been seen so we only emit on new updates:

```javascript
import { createParticles } from '@/lib/visualiser/particles.js'

// ... in onMounted:
const particlesCtx = createParticles(sceneCtx.scene)
const seenValues = new Map()  // elementId -> last timestamp

sceneCtx.onUpdate((dt) => {
  cameraCtrl.update(dt)

  // Check for new SSE values and emit particles
  for (const [id, vqt] of store.values) {
    const prev = seenValues.get(id)
    if (prev !== vqt.timestamp) {
      seenValues.set(id, vqt.timestamp)
      particlesCtx.emit(id, vqt.quality, store.nodes, positions, (nodeId) => {
        nodesCtx.flash(nodeId)
      })
    }
  }

  nodesCtx.update(dt, store.values)
  particlesCtx.update(dt)
})
```

Add to `onBeforeUnmount`: `if (particlesCtx) particlesCtx.dispose()`

**Step 3: Verify**

Run dev server. Should see:
- Tiny glowing particles spawning at leaf nodes
- Particles travel up the tree toward roots
- Colour matches quality (blue for Good, amber, red)
- Particles fade out as they travel
- Nodes flash briefly when a particle arrives
- Additive blending creates a nice glow effect

**Step 4: Commit**

```bash
git add acs-admin/src/lib/visualiser/particles.js \
  acs-admin/src/pages/Visualiser/Visualiser.vue
git commit -m "Add pooled pulse particles for live data flow visualisation"
```

---

### Task 8: LOD labels

**Files:**
- Create: `acs-admin/src/lib/visualiser/lod.js`
- Modify: `acs-admin/src/pages/Visualiser/Visualiser.vue`

**Step 1: Create lod.js**

Manages text labels (using Three.js Sprite + canvas texture) that appear
when the camera is close enough.

Create `acs-admin/src/lib/visualiser/lod.js`:

```javascript
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import { LOD_LABEL, LOD_SPARKLINE_SHOW, LOD_SPARKLINE_HIDE } from './constants.js'

function createLabelTexture (text) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  const fontSize = 48
  ctx.font = `${fontSize}px sans-serif`
  const metrics = ctx.measureText(text)
  const width = Math.ceil(metrics.width) + 20
  const height = fontSize + 20

  canvas.width = width
  canvas.height = height

  ctx.font = `${fontSize}px sans-serif`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 10, height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  return { texture, aspect: width / height }
}

export function createLOD (scene, storeNodes, positions) {
  const labels = new Map()  // elementId -> { sprite, position }
  const visible = new Set()
  const sparklineVisible = new Set()

  // Pre-create label sprites (hidden initially)
  for (const [id, entry] of storeNodes) {
    const pos = positions.get(id)
    if (!pos) continue

    const name = entry.node.displayName || entry.node.elementId.slice(0, 8)
    const { texture, aspect } = createLabelTexture(name)
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const sprite = new THREE.Sprite(material)
    const scale = 2
    sprite.scale.set(scale * aspect, scale, 1)
    sprite.position.copy(pos)
    sprite.position.y += entry.childIds.length === 0 ? 0.5 : 2
    sprite.visible = false
    scene.add(sprite)

    labels.set(id, { sprite, material, pos: sprite.position })
  }

  /**
   * @param {THREE.Camera} camera
   * @param {number} dt
   * @param {function} onSparklineShow - called with elementId when sparkline should appear
   * @param {function} onSparklineHide - called with elementId when sparkline should hide
   */
  function update (camera, dt, onSparklineShow, onSparklineHide) {
    const camPos = camera.position

    for (const [id, label] of labels) {
      const dist = camPos.distanceTo(label.pos)

      // Labels
      if (dist < LOD_LABEL) {
        if (!visible.has(id)) {
          label.sprite.visible = true
          visible.add(id)
        }
        // Fade in/out based on distance
        const t = 1 - (dist / LOD_LABEL)
        label.material.opacity = Math.min(t * 2, 0.9)
      } else {
        if (visible.has(id)) {
          label.sprite.visible = false
          label.material.opacity = 0
          visible.delete(id)
        }
      }

      // Sparklines (with hysteresis)
      if (dist < LOD_SPARKLINE_SHOW && !sparklineVisible.has(id)) {
        sparklineVisible.add(id)
        onSparklineShow?.(id)
      } else if (dist > LOD_SPARKLINE_HIDE && sparklineVisible.has(id)) {
        sparklineVisible.delete(id)
        onSparklineHide?.(id)
      }
    }
  }

  function dispose () {
    for (const [, label] of labels) {
      scene.remove(label.sprite)
      label.material.map.dispose()
      label.material.dispose()
    }
  }

  return { update, dispose }
}
```

**Step 2: Wire into Visualiser.vue**

```javascript
import { createLOD } from '@/lib/visualiser/lod.js'

// ... in onMounted after particles:
const lodCtx = createLOD(sceneCtx.scene, store.nodes, positions)

sceneCtx.onUpdate((dt) => {
  cameraCtrl.update(dt)

  // ... existing SSE/particle/node update code ...

  lodCtx.update(
    sceneCtx.camera,
    dt,
    (id) => store.fetchHistory(id),
    (id) => store.evictHistory(id),
  )
})
```

Add to `onBeforeUnmount`: `if (lodCtx) lodCtx.dispose()`

**Step 3: Verify**

Run dev server. During a camera sweep-in, labels should:
- Fade in as camera approaches nodes (< 40 units)
- Show node display names
- Fade out as camera pulls back
- Console should show history fetch calls when very close (< 15 units)

**Step 4: Commit**

```bash
git add acs-admin/src/lib/visualiser/lod.js \
  acs-admin/src/pages/Visualiser/Visualiser.vue
git commit -m "Add LOD labels that fade in on camera approach"
```

---

### Task 9: Sparkline history charts

**Files:**
- Create: `acs-admin/src/lib/visualiser/sparklines.js`
- Modify: `acs-admin/src/pages/Visualiser/Visualiser.vue`

**Step 1: Create sparklines.js**

Renders a mini line chart as a textured plane near leaf nodes when
the camera is close. Charts update each frame from the store's history
cache (which includes live SSE tail).

Create `acs-admin/src/lib/visualiser/sparklines.js`:

```javascript
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import {
  SPARKLINE_WIDTH, SPARKLINE_HEIGHT, SPARKLINE_HISTORY_SECS,
  COLOUR_GOOD, COLOUR_UNCERTAIN, COLOUR_BAD,
} from './constants.js'

const QUALITY_CSS = {
  Good: '#009FE3',
  GoodNoData: '#009FE3',
  Uncertain: '#F5A623',
  Bad: '#F24B5B',
}

function drawSparkline (canvas, ctx, points, quality) {
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  if (points.length < 2) return

  // Background
  ctx.fillStyle = 'rgba(10, 10, 26, 0.7)'
  ctx.fillRect(0, 0, w, h)

  // Compute value range
  let min = Infinity
  let max = -Infinity
  for (const p of points) {
    if (p.value < min) min = p.value
    if (p.value > max) max = p.value
  }
  const range = max - min || 1

  // Time range: last SPARKLINE_HISTORY_SECS
  const now = Date.now()
  const timeStart = now - SPARKLINE_HISTORY_SECS * 1000

  const colour = QUALITY_CSS[quality] ?? '#888888'

  // Draw line
  ctx.strokeStyle = colour
  ctx.lineWidth = 2
  ctx.beginPath()

  let started = false
  for (const p of points) {
    const t = new Date(p.timestamp).getTime()
    const x = ((t - timeStart) / (SPARKLINE_HISTORY_SECS * 1000)) * w
    const y = h - ((p.value - min) / range) * (h * 0.8) - h * 0.1

    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()

  // Fill under line
  ctx.lineTo(w, h)
  ctx.lineTo(0, h)
  ctx.closePath()
  ctx.fillStyle = colour.replace(')', ', 0.15)').replace('rgb', 'rgba')
  ctx.fill()
}

export function createSparklines (scene) {
  const active = new Map()  // elementId -> { plane, canvas, ctx, texture }

  function show (elementId, position) {
    if (active.has(elementId)) return

    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })

    const geometry = new THREE.PlaneGeometry(SPARKLINE_WIDTH, SPARKLINE_HEIGHT)
    const plane = new THREE.Mesh(geometry, material)
    plane.position.copy(position)
    plane.position.x += SPARKLINE_WIDTH * 0.6
    plane.position.y += SPARKLINE_HEIGHT * 0.3
    scene.add(plane)

    active.set(elementId, { plane, canvas, ctx, texture, material, geometry })
  }

  function hide (elementId) {
    const entry = active.get(elementId)
    if (!entry) return
    scene.remove(entry.plane)
    entry.texture.dispose()
    entry.material.dispose()
    entry.geometry.dispose()
    active.delete(elementId)
  }

  function update (camera, storeHistory, storeValues) {
    for (const [id, entry] of active) {
      const hist = storeHistory.get(id)
      const vqt = storeValues.get(id)
      const quality = vqt?.quality ?? 'Good'

      if (hist && hist.points.length > 0) {
        drawSparkline(entry.canvas, entry.ctx, hist.points, quality)
        entry.texture.needsUpdate = true
      }

      // Billboard: face the camera
      entry.plane.lookAt(camera.position)
    }
  }

  function dispose () {
    for (const [id] of active) hide(id)
  }

  return { show, hide, update, dispose }
}
```

**Step 2: Wire into Visualiser.vue**

```javascript
import { createSparklines } from '@/lib/visualiser/sparklines.js'

// ... in onMounted after LOD:
const sparklinesCtx = createSparklines(sceneCtx.scene)

// Update LOD callbacks to show/hide sparklines:
lodCtx.update(
  sceneCtx.camera,
  dt,
  (id) => {
    store.fetchHistory(id)
    const pos = positions.get(id)
    if (pos) sparklinesCtx.show(id, pos)
  },
  (id) => {
    store.evictHistory(id)
    sparklinesCtx.hide(id)
  },
)

// In the render loop, add sparkline update:
sparklinesCtx.update(sceneCtx.camera, store.history, store.values)
```

Add to `onBeforeUnmount`: `if (sparklinesCtx) sparklinesCtx.dispose()`

**Step 3: Verify**

Run dev server. During camera sweep-in to a leaf node:
- Small chart plane appears near the node
- Shows history line for last 60s
- Chart updates in real-time as new SSE values append
- Colour matches quality state
- Chart billboards (always faces camera)
- Chart disappears when camera pulls back (with hysteresis)

**Step 4: Commit**

```bash
git add acs-admin/src/lib/visualiser/sparklines.js \
  acs-admin/src/pages/Visualiser/Visualiser.vue
git commit -m "Add sparkline history charts that appear on camera approach"
```

---

### Task 10: Final integration and polish

**Files:**
- Modify: `acs-admin/src/pages/Visualiser/Visualiser.vue` (final assembly)

**Step 1: Clean up Visualiser.vue**

Ensure all modules are properly integrated. The final `Visualiser.vue`
should have clean lifecycle management with all contexts created in
`onMounted` and disposed in `onBeforeUnmount`.

Write the final version of `Visualiser.vue` with all imports and clean
orchestration. Ensure:

- All contexts stored in a single object for easy cleanup
- Render loop callback order: camera -> particles -> nodes -> LOD -> sparklines
- SSE value tracking in the render loop (seenValues map)
- Proper disposal order (sparklines, LOD, particles, nodes, edges, scene)

**Step 2: Add a loading indicator**

Add a simple text overlay while the tree is loading:

```vue
<template>
  <div class="fixed inset-0 bg-[#0a0a1a]">
    <canvas ref="canvas" class="w-full h-full block" />
    <div v-if="!store.loaded" class="absolute inset-0 flex items-center justify-center">
      <p class="text-white/50 text-sm">Loading hierarchy...</p>
    </div>
  </div>
</template>
```

**Step 3: Verify everything end-to-end**

Run dev server. Full verification checklist:
- [ ] Dark cosmos background with star field
- [ ] Bloom glow on all nodes
- [ ] Hierarchy visible as radial 3D graph
- [ ] Nodes colour-coded by quality (blue/amber/red/grey)
- [ ] Thin edge lines between parent-child nodes
- [ ] Camera auto-orbits with gentle drift
- [ ] Camera sweeps into random clusters every 30-45s
- [ ] Particles emit from leaves on SSE updates
- [ ] Particles travel up tree, nodes flash on arrival
- [ ] Labels fade in on camera approach (< 40 units)
- [ ] Sparkline charts appear near leaves on close approach (< 15 units)
- [ ] Sparklines show history + live tail
- [ ] Sparklines disappear when camera pulls back
- [ ] Escape exits fullscreen
- [ ] No console errors
- [ ] No memory leaks (check Task Manager over 5 minutes)
- [ ] Loading indicator shows while tree loads

**Step 4: Commit**

```bash
git add acs-admin/src/pages/Visualiser/Visualiser.vue
git commit -m "Polish visualiser integration, add loading state"
```
