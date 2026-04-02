# i3X Explorer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Add an i3X Explorer page to acs-admin that provides hierarchy browsing, node inspection, relationship graphs, historical data, and live monitoring via the acs-i3x service API.

**Architecture:** New `/explorer` route with a three-panel layout (tree, main, sidebar). Composable-based API client talks to acs-i3x `/v1/` endpoints. Pinia stores manage tree state and subscription state. Heavy libraries (Cytoscape.js, ECharts) are lazy-loaded via dynamic `import()`.

**Tech Stack:** Vue 3 + Composition API, Pinia, shadcn-vue (Reka UI), Tailwind CSS, Cytoscape.js, ECharts + vue-echarts, @microsoft/fetch-event-source, dayjs (already installed).

---

### Task 0: Install dependencies and configure environment

**Files:**
- Modify: `acs-admin/package.json`
- Modify: `acs-admin/.env`
- Modify: `acs-admin/.env.example`

**Step 1: Install new packages**

```bash
cd /Users/me1ago/code/amrc-connectivity-stack/acs-admin
npm install cytoscape echarts vue-echarts @microsoft/fetch-event-source
```

**Step 2: Add env var for i3X base URL**

Add to `.env`:
```
I3X_BASE_URL=http://localhost:8080/v1
```

Add to `.env.example`:
```
I3X_BASE_URL=
```

**Step 3: Register env var in vite config**

The `@import-meta-env/unplugin` plugin reads from `.env` automatically — no vite config change needed. Verify by checking that `import.meta.env.I3X_BASE_URL` is accessible in browser console after dev server restart.

**Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "Add i3X Explorer dependencies and environment config"
```

Note: Do NOT commit `.env` — it contains local values.

---

### Task 1: QualityBadge shared component

**Files:**
- Create: `acs-admin/src/components/QualityBadge.vue`

**Step 1: Create the component**

```vue
<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'

const props = defineProps({
  quality: {
    type: String,
    default: null,
    validator: v => [null, 'Good', 'GoodNoData', 'Bad', 'Uncertain'].includes(v),
  },
})

const config = computed(() => {
  switch (props.quality) {
    case 'Good':
      return { label: 'Good', class: 'bg-green-500 text-white border-green-500' }
    case 'Uncertain':
      return { label: 'Uncertain', class: 'bg-yellow-500 text-white border-yellow-500' }
    case 'GoodNoData':
      return { label: 'No Data', class: 'bg-slate-400 text-white border-slate-400' }
    case 'Bad':
      return { label: 'Bad', class: 'bg-red-500 text-white border-red-500' }
    default:
      return { label: 'Unknown', class: 'bg-slate-300 text-slate-600 border-slate-300' }
  }
})
</script>

<template>
  <Badge :class="config.class" class="text-[10px] px-1.5 py-0">
    {{ config.label }}
  </Badge>
</template>
```

**Step 2: Verify** — Import into any existing page temporarily and render `<QualityBadge quality="Good"/>` to confirm styling.

**Step 3: Commit**

```bash
git add src/components/QualityBadge.vue
git commit -m "Add QualityBadge component for i3X quality indicators"
```

---

### Task 2: i3X API client composable

**Files:**
- Create: `acs-admin/src/composables/useI3xClient.js`

**Step 1: Create the composable**

This wraps all acs-i3x `/v1/` endpoints. It unwraps the `{ success, result }` envelope and throws on errors.

```js
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

const BASE_URL = import.meta.env.I3X_BASE_URL || 'http://localhost:8080/v1'

async function request (path, options = {}) {
  const url = `${BASE_URL}${path}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error?.message || `i3X request failed: ${res.status}`)
  }
  const body = await res.json()
  if (body.success === false) {
    throw new Error(body.error?.message || 'i3X request failed')
  }
  return body.result
}

async function get (path) {
  return request(path)
}

async function post (path, body) {
  return request(path, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function useI3xClient () {
  return {
    /** @returns {Promise<object>} Server info (specVersion, capabilities, etc.) */
    getInfo () {
      return get('/info')
    },

    /**
     * Get objects. Optional filters: root, typeElementId, includeMetadata.
     * @param {object} [params] - Query parameters
     * @returns {Promise<object[]>}
     */
    getObjects (params = {}) {
      const qs = new URLSearchParams()
      if (params.root != null) qs.set('root', String(params.root))
      if (params.typeElementId) qs.set('typeElementId', params.typeElementId)
      if (params.includeMetadata) qs.set('includeMetadata', 'true')
      const query = qs.toString()
      return get(`/objects${query ? '?' + query : ''}`)
    },

    /**
     * Get a single object by elementId.
     * @param {string} elementId
     * @returns {Promise<object>}
     */
    getObject (elementId) {
      return get(`/objects/${encodeURIComponent(elementId)}`)
    },

    /**
     * Get related objects for a single element.
     * @param {string} elementId
     * @param {string} [relationshipType]
     * @returns {Promise<object[]>}
     */
    getRelated (elementId, relationshipType) {
      const qs = relationshipType
        ? `?relationshiptype=${encodeURIComponent(relationshipType)}`
        : ''
      return get(`/objects/${encodeURIComponent(elementId)}/related${qs}`)
    },

    /**
     * Bulk get related objects for multiple elements.
     * @param {string[]} elementIds
     * @param {string} [relationshipType]
     * @returns {Promise<object>} Bulk response with results array
     */
    getRelatedBulk (elementIds, relationshipType) {
      const body = { elementIds }
      if (relationshipType) body.relationshiptype = relationshipType
      return post('/objects/related', body)
    },

    /**
     * Get current value for a single element.
     * @param {string} elementId
     * @returns {Promise<object>} { elementId, value, quality, timestamp, isComposition, components? }
     */
    getValue (elementId) {
      return get(`/objects/${encodeURIComponent(elementId)}/value`)
    },

    /**
     * Bulk get current values.
     * @param {string[]} elementIds
     * @param {number} [maxDepth]
     * @returns {Promise<object>} Bulk response
     */
    getValueBulk (elementIds, maxDepth) {
      const body = { elementIds }
      if (maxDepth != null) body.maxDepth = maxDepth
      return post('/objects/value', body)
    },

    /**
     * Get history for a single element.
     * @param {string} elementId
     * @param {string} startTime - RFC3339
     * @param {string} endTime - RFC3339
     * @returns {Promise<object>} { elementId, values: [{ value, quality, timestamp }] }
     */
    getHistory (elementId, startTime, endTime) {
      const qs = new URLSearchParams({ startTime, endTime })
      return get(`/objects/${encodeURIComponent(elementId)}/history?${qs}`)
    },

    /**
     * Bulk get history.
     * @param {object} params - { elementIds, startTime, endTime, maxDepth? }
     * @returns {Promise<object>} Bulk response
     */
    getHistoryBulk (params) {
      return post('/objects/history', params)
    },

    // --- Subscription endpoints ---

    createSubscription (clientId, displayName) {
      return post('/subscriptions', { clientId, displayName })
    },

    deleteSubscription (clientId, subscriptionIds) {
      return post('/subscriptions/delete', { clientId, subscriptionIds })
    },

    registerItems (clientId, subscriptionId, elementIds, maxDepth) {
      const body = { clientId, subscriptionId, elementIds }
      if (maxDepth != null) body.maxDepth = maxDepth
      return post('/subscriptions/register', body)
    },

    unregisterItems (clientId, subscriptionId, elementIds) {
      return post('/subscriptions/unregister', { clientId, subscriptionId, elementIds })
    },

    syncSubscription (clientId, subscriptionId, lastSequenceNumber) {
      const body = { clientId, subscriptionId }
      if (lastSequenceNumber != null) body.lastSequenceNumber = lastSequenceNumber
      return post('/subscriptions/sync', body)
    },

    /** Returns the base URL for constructing the SSE stream URL. */
    get baseUrl () {
      return BASE_URL
    },
  }
}
```

**Step 2: Verify** — In browser console or a temp component, call `useI3xClient().getInfo()` and confirm it returns the server info from localhost:8080.

**Step 3: Commit**

```bash
git add src/composables/useI3xClient.js
git commit -m "Add i3X API client composable"
```

---

### Task 3: Explorer store (tree state)

**Files:**
- Create: `acs-admin/src/store/useExplorerStore.js`

**Step 1: Create the store**

```js
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { defineStore } from 'pinia'
import { useI3xClient } from '@composables/useI3xClient.js'

export const useExplorerStore = defineStore('explorer', {
  state: () => ({
    /** @type {Map<string, { node: object, childIds: string[], expanded: boolean, loaded: boolean }>} */
    nodes: new Map(),
    /** @type {string[]} Root node IDs in display order */
    rootIds: [],
    /** @type {string|null} Currently selected node ID */
    selectedId: null,
    /** @type {boolean} Loading roots */
    loadingRoots: false,
    /** @type {Set<string>} Node IDs currently loading children */
    loadingChildren: new Set(),
    /** @type {string} Filter text for tree search */
    filter: '',
  }),

  getters: {
    selectedNode (state) {
      if (!state.selectedId) return null
      return state.nodes.get(state.selectedId)?.node ?? null
    },
  },

  actions: {
    async loadRoots () {
      if (this.loadingRoots) return
      this.loadingRoots = true
      try {
        const i3x = useI3xClient()
        const roots = await i3x.getObjects({ root: true })
        this.rootIds = []
        for (const obj of roots) {
          this.nodes.set(obj.elementId, {
            node: obj,
            childIds: [],
            expanded: false,
            loaded: false,
          })
          this.rootIds.push(obj.elementId)
        }
      } finally {
        this.loadingRoots = false
      }
    },

    async expandNode (elementId) {
      const entry = this.nodes.get(elementId)
      if (!entry) return

      entry.expanded = true

      // If already loaded, just expand
      if (entry.loaded) return

      this.loadingChildren.add(elementId)
      try {
        const i3x = useI3xClient()
        const children = await i3x.getRelated(elementId, 'i3x:rel:has-children')
        const childIds = []
        for (const child of children) {
          childIds.push(child.elementId)
          if (!this.nodes.has(child.elementId)) {
            this.nodes.set(child.elementId, {
              node: child,
              childIds: [],
              expanded: false,
              loaded: false,
            })
          }
        }
        entry.childIds = childIds
        entry.loaded = true
      } finally {
        this.loadingChildren.delete(elementId)
      }
    },

    collapseNode (elementId) {
      const entry = this.nodes.get(elementId)
      if (entry) entry.expanded = false
    },

    toggleNode (elementId) {
      const entry = this.nodes.get(elementId)
      if (!entry) return
      if (entry.expanded) {
        this.collapseNode(elementId)
      } else {
        this.expandNode(elementId)
      }
    },

    selectNode (elementId) {
      this.selectedId = elementId
    },
  },
})
```

**Step 2: Commit**

```bash
git add src/store/useExplorerStore.js
git commit -m "Add Explorer store for i3X tree state management"
```

---

### Task 4: Explorer page shell, routing, and nav entry

**Files:**
- Create: `acs-admin/src/pages/Explorer/Explorer.vue`
- Modify: `acs-admin/src/main.js` (add route)
- Modify: `acs-admin/src/components/Nav/Nav.vue` (add nav item)

**Step 1: Create the Explorer page shell**

```vue
<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { onMounted } from 'vue'
import { useExplorerStore } from '@store/useExplorerStore.js'

const store = useExplorerStore()

onMounted(() => {
  store.loadRoots()
})
</script>

<template>
  <div class="flex h-full min-h-0">
    <!-- Left panel: Tree -->
    <div class="w-72 border-r border-border flex flex-col overflow-hidden shrink-0">
      <div class="p-3 border-b">
        <input
          v-model="store.filter"
          type="text"
          placeholder="Filter hierarchy..."
          class="w-full px-3 py-1.5 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>
      <div class="flex-1 overflow-y-auto p-2">
        <div v-if="store.loadingRoots" class="text-sm text-slate-500 p-2">Loading...</div>
        <div v-else-if="store.rootIds.length === 0" class="text-sm text-slate-500 p-2">No objects found</div>
        <div v-else>
          <!-- ExplorerTreeNode will go here -->
          <div v-for="id in store.rootIds" :key="id" class="text-sm text-slate-700">
            {{ store.nodes.get(id)?.node?.displayName ?? id }}
          </div>
        </div>
      </div>
    </div>

    <!-- Main panel -->
    <div class="flex-1 flex flex-col overflow-y-auto p-4 gap-4">
      <div v-if="!store.selectedId" class="flex items-center justify-center h-full text-slate-400 text-sm">
        Select a node from the hierarchy to view details
      </div>
      <div v-else>
        <!-- RelationshipGraph, CurrentValue, HistoryPanel will go here -->
        <div class="text-sm text-slate-500">Selected: {{ store.selectedNode?.displayName }}</div>
      </div>
    </div>

    <!-- Right sidebar -->
    <div v-if="store.selectedId" class="w-96 border-l border-border hidden xl:block overflow-y-auto shrink-0">
      <!-- NodeDetail will go here -->
      <div class="p-4 text-sm text-slate-500">Node detail sidebar</div>
    </div>
  </div>
</template>
```

**Step 2: Add route to main.js**

In `acs-admin/src/main.js`, add the import at the top (lazy-loaded) and the route after the Home route:

```js
// Add this route object after the Home route (path: '/') in the routes array:
{
  path: '/explorer',
  component: () => import('@pages/Explorer/Explorer.vue'),
  meta: {
    name: 'Explorer',
    icon: 'compass',
  },
},
```

**Step 3: Add nav item to Nav.vue**

In `acs-admin/src/components/Nav/Nav.vue`, add after the Home entry in `sidebarNavItems`:

```js
{
    title: 'Explorer',
    href: '/explorer',
    icon: 'compass',
    auth: true
},
```

**Step 4: Verify** — Run `npm run dev`, navigate to `/#/explorer`. Should see the three-panel layout with loading roots from the API. The sidebar nav should show "Explorer" below "Home".

**Step 5: Commit**

```bash
git add src/pages/Explorer/Explorer.vue src/main.js src/components/Nav/Nav.vue
git commit -m "Add Explorer page shell with routing and navigation"
```

---

### Task 5: Hierarchy tree (ExplorerTreeNode)

**Files:**
- Create: `acs-admin/src/pages/Explorer/ExplorerTreeNode.vue`
- Modify: `acs-admin/src/pages/Explorer/Explorer.vue` (replace placeholder)

**Step 1: Create recursive tree node component**

```vue
<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { computed } from 'vue'
import { useExplorerStore } from '@store/useExplorerStore.js'

const props = defineProps({
  elementId: { type: String, required: true },
  depth: { type: Number, default: 0 },
})

const store = useExplorerStore()

const entry = computed(() => store.nodes.get(props.elementId))
const node = computed(() => entry.value?.node)
const isSelected = computed(() => store.selectedId === props.elementId)
const isExpanded = computed(() => entry.value?.expanded ?? false)
const isLoading = computed(() => store.loadingChildren.has(props.elementId))
const hasChildren = computed(() => {
  // Compositions can have children; also if we've loaded children and found some
  if (entry.value?.loaded) return entry.value.childIds.length > 0
  return node.value?.isComposition ?? false
})

const isVisible = computed(() => {
  if (!store.filter) return true
  return node.value?.displayName?.toLowerCase().includes(store.filter.toLowerCase())
})

function handleClick () {
  store.selectNode(props.elementId)
}

function handleToggle (e) {
  e.stopPropagation()
  store.toggleNode(props.elementId)
}
</script>

<template>
  <div v-if="isVisible">
    <div
      class="flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer text-sm hover:bg-slate-100 transition-colors"
      :class="{ 'bg-slate-200 font-medium': isSelected }"
      :style="{ paddingLeft: `${depth * 16 + 8}px` }"
      @click="handleClick"
    >
      <!-- Expand/collapse chevron -->
      <button
        v-if="hasChildren"
        class="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-600 shrink-0"
        @click="handleToggle"
      >
        <i
          class="fa-solid fa-chevron-right text-[10px] transition-transform duration-200"
          :class="{ 'rotate-90': isExpanded }"
        ></i>
      </button>
      <span v-else class="w-4 shrink-0"></span>

      <!-- Icon -->
      <i
        class="fa-solid text-[10px] shrink-0"
        :class="node?.isComposition ? 'fa-folder text-amber-500' : 'fa-circle text-slate-400'"
      ></i>

      <!-- Label -->
      <span class="truncate">{{ node?.displayName ?? elementId }}</span>

      <!-- Loading spinner -->
      <i v-if="isLoading" class="fa-solid fa-spinner fa-spin text-[10px] text-slate-400 ml-auto"></i>
    </div>

    <!-- Children (recursive) -->
    <div v-if="isExpanded && entry?.childIds?.length">
      <ExplorerTreeNode
        v-for="childId in entry.childIds"
        :key="childId"
        :element-id="childId"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>
```

**Step 2: Update Explorer.vue to use ExplorerTreeNode**

Replace the placeholder `<div v-for="id in store.rootIds"...>` block in the tree panel with:

```vue
<ExplorerTreeNode
  v-for="id in store.rootIds"
  :key="id"
  :element-id="id"
/>
```

And add the import:

```vue
import ExplorerTreeNode from './ExplorerTreeNode.vue'
```

**Step 3: Verify** — Navigate to Explorer, see hierarchy tree. Click nodes to select. Click chevrons to expand and lazy-load children. Filter input filters visible nodes.

**Step 4: Commit**

```bash
git add src/pages/Explorer/ExplorerTreeNode.vue src/pages/Explorer/Explorer.vue
git commit -m "Add hierarchy tree with lazy-loading and filtering"
```

---

### Task 6: Node detail sidebar

**Files:**
- Create: `acs-admin/src/pages/Explorer/NodeDetail.vue`
- Modify: `acs-admin/src/pages/Explorer/Explorer.vue` (replace sidebar placeholder)

**Step 1: Create the sidebar component**

```vue
<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import SidebarDetail from '@components/SidebarDetail.vue'
import { Badge } from '@/components/ui/badge'

const props = defineProps({
  node: { type: Object, required: true },
})

const emit = defineEmits(['subscribe'])

const compositionLabel = computed(() => props.node.isComposition ? 'Yes' : 'No')
</script>

<template>
  <div>
    <div class="flex items-center justify-start gap-2 p-4 border-b">
      <i class="fa-fw fa-solid" :class="node.isComposition ? 'fa-folder text-amber-500' : 'fa-circle-dot text-slate-500'"></i>
      <div class="font-semibold text-xl truncate">{{ node.displayName }}</div>
    </div>
    <div class="space-y-4 p-4">
      <SidebarDetail
        icon="fingerprint"
        label="Element ID"
        :value="node.elementId"
      />
      <SidebarDetail
        icon="tag"
        label="Type ID"
        :value="node.typeElementId"
      />
      <SidebarDetail
        icon="sitemap"
        label="Parent ID"
        :value="node.parentId || '(root)'"
      />
      <SidebarDetail
        icon="globe"
        label="Namespace URI"
        :value="node.namespaceUri || '-'"
      />
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-1.5">
          <i class="fa-fw fa-solid fa-cubes" style="font-size: 0.6rem"></i>
          <label class="flex items-center rounded-md text-xs font-medium">Composition</label>
        </div>
        <Badge :variant="node.isComposition ? 'default' : 'secondary'" class="w-fit">
          {{ compositionLabel }}
        </Badge>
      </div>

      <div class="pt-4 border-t">
        <Button class="w-full" @click="emit('subscribe')">
          <i class="fa-solid fa-eye mr-2"></i>
          Subscribe
        </Button>
      </div>
    </div>
  </div>
</template>
```

**Step 2: Wire into Explorer.vue**

Replace the right sidebar placeholder with:

```vue
<NodeDetail
  :node="store.selectedNode"
  @subscribe="handleSubscribe"
/>
```

Add import and handler:

```js
import NodeDetail from './NodeDetail.vue'

function handleSubscribe () {
  // Will be wired to monitor store in Task 10
}
```

**Step 3: Verify** — Select a node in the tree, see metadata populate in the right sidebar with copyable fields.

**Step 4: Commit**

```bash
git add src/pages/Explorer/NodeDetail.vue src/pages/Explorer/Explorer.vue
git commit -m "Add node detail sidebar with metadata display"
```

---

### Task 7: Current value card

**Files:**
- Create: `acs-admin/src/pages/Explorer/CurrentValue.vue`
- Modify: `acs-admin/src/pages/Explorer/Explorer.vue` (wire into main panel)

**Step 1: Create the component**

```vue
<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { ref, watch } from 'vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import QualityBadge from '@components/QualityBadge.vue'
import { useI3xClient } from '@composables/useI3xClient.js'
import dayjs from 'dayjs'

const props = defineProps({
  elementId: { type: String, required: true },
  isComposition: { type: Boolean, default: false },
})

const i3x = useI3xClient()
const loading = ref(false)
const error = ref(null)
const data = ref(null)

async function fetchValue () {
  loading.value = true
  error.value = null
  try {
    data.value = await i3x.getValue(props.elementId)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

watch(() => props.elementId, () => {
  data.value = null
  fetchValue()
}, { immediate: true })

function formatTimestamp (ts) {
  if (!ts) return '-'
  return dayjs(ts).format('YYYY-MM-DD HH:mm:ss')
}

function formatValue (val) {
  if (val === null || val === undefined) return '-'
  if (typeof val === 'object') return JSON.stringify(val, null, 2)
  return String(val)
}
</script>

<template>
  <Card>
    <CardHeader class="pb-3">
      <div class="flex items-center justify-between">
        <CardTitle class="text-base">Current Value</CardTitle>
        <Button variant="ghost" size="sm" @click="fetchValue" :disabled="loading">
          <i class="fa-solid fa-rotate-right" :class="{ 'fa-spin': loading }"></i>
        </Button>
      </div>
    </CardHeader>
    <CardContent>
      <div v-if="error" class="text-sm text-red-500">{{ error }}</div>
      <div v-else-if="loading && !data" class="text-sm text-slate-400">Loading...</div>
      <div v-else-if="data">
        <!-- Leaf node value -->
        <div v-if="!data.isComposition" class="flex items-center gap-3">
          <span class="text-2xl font-semibold font-mono">{{ formatValue(data.value) }}</span>
          <QualityBadge :quality="data.quality" />
          <span class="text-xs text-slate-400 ml-auto">{{ formatTimestamp(data.timestamp) }}</span>
        </div>

        <!-- Composition: show components table -->
        <div v-else>
          <p class="text-sm text-slate-500 mb-3">Composition with {{ Object.keys(data.components || {}).length }} components</p>
          <div class="border rounded-md overflow-hidden" v-if="data.components">
            <table class="w-full text-sm">
              <thead class="bg-slate-50">
                <tr>
                  <th class="text-left px-3 py-1.5 font-medium text-slate-600">Component</th>
                  <th class="text-left px-3 py-1.5 font-medium text-slate-600">Value</th>
                  <th class="text-left px-3 py-1.5 font-medium text-slate-600">Quality</th>
                  <th class="text-left px-3 py-1.5 font-medium text-slate-600">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(vqt, key) in data.components" :key="key" class="border-t">
                  <td class="px-3 py-1.5 font-mono text-xs truncate max-w-[200px]">{{ key }}</td>
                  <td class="px-3 py-1.5 font-mono">{{ formatValue(vqt.value) }}</td>
                  <td class="px-3 py-1.5"><QualityBadge :quality="vqt.quality" /></td>
                  <td class="px-3 py-1.5 text-xs text-slate-400">{{ formatTimestamp(vqt.timestamp) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div v-else class="text-sm text-slate-400">No value available</div>
    </CardContent>
  </Card>
</template>
```

**Step 2: Wire into Explorer.vue main panel**

Replace the selected-state placeholder with:

```vue
<CurrentValue
  :element-id="store.selectedId"
  :is-composition="store.selectedNode?.isComposition ?? false"
/>
```

**Step 3: Verify** — Select a leaf node, see current value with quality badge and timestamp. Select a composition, see components table. Click refresh to re-fetch.

**Step 4: Commit**

```bash
git add src/pages/Explorer/CurrentValue.vue src/pages/Explorer/Explorer.vue
git commit -m "Add current value display with quality badges"
```

---

### Task 8: Relationship graph (Cytoscape.js)

**Files:**
- Create: `acs-admin/src/pages/Explorer/RelationshipGraph.vue`
- Modify: `acs-admin/src/pages/Explorer/Explorer.vue` (wire into main panel above CurrentValue)

**Step 1: Create the component**

```vue
<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick, shallowRef } from 'vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useI3xClient } from '@composables/useI3xClient.js'

const props = defineProps({
  elementId: { type: String, required: true },
  displayName: { type: String, default: '' },
})

const emit = defineEmits(['navigate'])

const i3x = useI3xClient()
const containerRef = ref(null)
const cy = shallowRef(null)
const depth = ref(1)
const loading = ref(false)
const maxDepth = 3

async function loadGraph () {
  if (!props.elementId) return
  loading.value = true

  try {
    // Lazy-load cytoscape
    const cytoscape = (await import('cytoscape')).default

    // Collect nodes and edges by traversing depth layers
    const nodesMap = new Map()
    const edges = []

    // Start with selected node
    const rootObj = { elementId: props.elementId, displayName: props.displayName }
    nodesMap.set(props.elementId, { data: { id: props.elementId, label: rootObj.displayName || props.elementId, type: 'selected' } })

    let currentLayerIds = [props.elementId]

    for (let d = 0; d < depth.value; d++) {
      if (currentLayerIds.length === 0) break

      // Bulk fetch related for all nodes at this depth
      const nextLayerIds = []
      // Use individual calls since bulk returns per-element results
      const results = await Promise.all(
        currentLayerIds.map(id => i3x.getRelated(id).then(related => ({ id, related })).catch(() => ({ id, related: [] })))
      )

      for (const { id, related } of results) {
        for (const rel of related) {
          if (!nodesMap.has(rel.elementId)) {
            // Determine relationship type
            const relType = rel.parentId === id ? 'child'
              : nodesMap.get(id) && rel.elementId === nodesMap.get(id)?.data?.parentId ? 'parent'
              : 'related'

            nodesMap.set(rel.elementId, {
              data: {
                id: rel.elementId,
                label: rel.displayName || rel.elementId,
                type: relType,
                parentId: rel.parentId,
              }
            })
            nextLayerIds.push(rel.elementId)
          }

          // Add edge if not duplicate
          const edgeId = `${id}-${rel.elementId}`
          const reverseEdgeId = `${rel.elementId}-${id}`
          if (!edges.find(e => e.data.id === edgeId || e.data.id === reverseEdgeId)) {
            edges.push({
              data: {
                id: edgeId,
                source: id,
                target: rel.elementId,
              }
            })
          }
        }
      }

      currentLayerIds = nextLayerIds
    }

    // Destroy existing instance
    if (cy.value) {
      cy.value.destroy()
      cy.value = null
    }

    await nextTick()

    if (!containerRef.value) return

    cy.value = cytoscape({
      container: containerRef.value,
      elements: {
        nodes: Array.from(nodesMap.values()),
        edges,
      },
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'background-color': '#e2e8f0',
            'border-width': 2,
            'border-color': '#94a3b8',
            'font-size': '11px',
            'text-wrap': 'ellipsis',
            'text-max-width': '120px',
            'width': 'label',
            'height': 40,
            'padding': '12px',
            'shape': 'round-rectangle',
            'text-outline-color': '#fff',
            'text-outline-width': 2,
          },
        },
        {
          selector: 'node[type="selected"]',
          style: {
            'background-color': '#3b82f6',
            'border-color': '#2563eb',
            'color': '#fff',
            'text-outline-color': '#3b82f6',
            'font-weight': 'bold',
          },
        },
        {
          selector: 'node[type="parent"]',
          style: {
            'border-color': '#f59e0b',
            'border-width': 3,
          },
        },
        {
          selector: 'node[type="child"]',
          style: {
            'border-color': '#22c55e',
            'border-width': 3,
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 2,
            'line-color': '#cbd5e1',
            'curve-style': 'bezier',
          },
        },
      ],
      layout: {
        name: 'breadthfirst',
        directed: true,
        roots: `#${CSS.escape(props.elementId)}`,
        spacingFactor: 1.5,
        padding: 30,
      },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
    })

    // Click to navigate
    cy.value.on('tap', 'node', (evt) => {
      const nodeId = evt.target.id()
      if (nodeId !== props.elementId) {
        emit('navigate', nodeId)
      }
    })

    // Cursor change on hover
    cy.value.on('mouseover', 'node', (evt) => {
      if (evt.target.id() !== props.elementId) {
        containerRef.value.style.cursor = 'pointer'
      }
    })
    cy.value.on('mouseout', 'node', () => {
      containerRef.value.style.cursor = 'default'
    })
  } finally {
    loading.value = false
  }
}

function fitGraph () {
  cy.value?.fit(undefined, 30)
}

watch(() => props.elementId, loadGraph)
watch(depth, loadGraph)
onMounted(loadGraph)

onBeforeUnmount(() => {
  if (cy.value) {
    cy.value.destroy()
    cy.value = null
  }
})
</script>

<template>
  <Card>
    <CardHeader class="pb-3">
      <div class="flex items-center justify-between">
        <CardTitle class="text-base">Relationship Graph</CardTitle>
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2 text-sm text-slate-500">
            <span>Depth:</span>
            <input
              type="range"
              :min="1"
              :max="maxDepth"
              v-model.number="depth"
              class="w-20 accent-slate-600"
            />
            <span class="font-mono w-4 text-center">{{ depth }}</span>
          </div>
          <Button variant="ghost" size="sm" @click="fitGraph" title="Fit to view">
            <i class="fa-solid fa-expand"></i>
          </Button>
        </div>
      </div>
    </CardHeader>
    <CardContent class="p-0">
      <div class="relative">
        <div
          v-if="loading"
          class="absolute inset-0 flex items-center justify-center bg-white/80 z-10"
        >
          <i class="fa-solid fa-spinner fa-spin text-slate-400"></i>
        </div>
        <div ref="containerRef" class="h-[350px] w-full"></div>
      </div>
      <!-- Legend -->
      <div class="flex items-center gap-4 px-4 py-2 border-t text-xs text-slate-500">
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-blue-500 inline-block"></span> Selected</span>
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded border-2 border-amber-500 bg-slate-100 inline-block"></span> Parent</span>
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded border-2 border-green-500 bg-slate-100 inline-block"></span> Child</span>
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded border-2 border-slate-400 bg-slate-100 inline-block"></span> Related</span>
      </div>
    </CardContent>
  </Card>
</template>
```

**Step 2: Wire into Explorer.vue**

In the main panel `v-else` block, add above CurrentValue:

```vue
<RelationshipGraph
  :element-id="store.selectedId"
  :display-name="store.selectedNode?.displayName"
  @navigate="store.selectNode"
/>
```

**Step 3: Verify** — Select a node, see the graph render with parent/child relationships. Drag the depth slider to load more layers. Click a graph node to navigate. Pan/zoom works.

**Step 4: Commit**

```bash
git add src/pages/Explorer/RelationshipGraph.vue src/pages/Explorer/Explorer.vue
git commit -m "Add interactive relationship graph with Cytoscape.js"
```

---

### Task 9: History panel (ECharts + CSV export)

**Files:**
- Create: `acs-admin/src/pages/Explorer/HistoryPanel.vue`
- Modify: `acs-admin/src/pages/Explorer/Explorer.vue` (wire into main panel below CurrentValue)

**Step 1: Create the component**

```vue
<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { ref, computed, watch, defineAsyncComponent } from 'vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import QualityBadge from '@components/QualityBadge.vue'
import { useI3xClient } from '@composables/useI3xClient.js'
import dayjs from 'dayjs'

// Lazy-load ECharts
const VChart = defineAsyncComponent(() =>
  import('vue-echarts').then(m => m.default ?? m)
)

const props = defineProps({
  elementId: { type: String, required: true },
  isComposition: { type: Boolean, default: false },
})

const i3x = useI3xClient()
const loading = ref(false)
const error = ref(null)
const historyData = ref(null)
const selectedPreset = ref('1h')

const presets = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
]

// Custom range
const customStart = ref('')
const customEnd = ref('')
const showCustom = ref(false)

function selectPreset (preset) {
  selectedPreset.value = preset.label
  showCustom.value = false
}

function selectCustom () {
  selectedPreset.value = 'custom'
  showCustom.value = true
}

function getTimeRange () {
  if (selectedPreset.value === 'custom') {
    return {
      startTime: new Date(customStart.value).toISOString(),
      endTime: new Date(customEnd.value).toISOString(),
    }
  }
  const preset = presets.find(p => p.label === selectedPreset.value)
  const end = new Date()
  const start = new Date(end.getTime() - preset.hours * 60 * 60 * 1000)
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  }
}

async function loadHistory () {
  loading.value = true
  error.value = null
  historyData.value = null
  try {
    const { startTime, endTime } = getTimeRange()
    const result = await i3x.getHistory(props.elementId, startTime, endTime)
    historyData.value = result
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

// Reset when element changes
watch(() => props.elementId, () => {
  historyData.value = null
  error.value = null
})

// Determine if data is numeric
const isNumeric = computed(() => {
  if (!historyData.value?.values?.length) return false
  return historyData.value.values.some(v => typeof v.value === 'number')
})

// ECharts option
const chartOption = computed(() => {
  if (!historyData.value?.values?.length || !isNumeric.value) return null

  const values = historyData.value.values
  const timestamps = values.map(v => v.timestamp)
  const data = values.map(v => typeof v.value === 'number' ? v.value : null)

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter (params) {
        const p = params[0]
        if (!p) return ''
        return `${dayjs(p.axisValue).format('YYYY-MM-DD HH:mm:ss')}<br/>Value: <b>${p.value ?? '-'}</b>`
      },
    },
    grid: {
      left: 60,
      right: 20,
      top: 20,
      bottom: 60,
    },
    xAxis: {
      type: 'time',
      data: timestamps,
      axisLabel: {
        formatter: (val) => dayjs(val).format('HH:mm:ss'),
      },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (val) => Number(val).toPrecision(4),
      },
    },
    dataZoom: [
      { type: 'slider', xAxisIndex: 0, start: 0, end: 100, height: 20 },
      { type: 'inside', xAxisIndex: 0 },
    ],
    series: [
      {
        type: 'line',
        data: values.map(v => [v.timestamp, typeof v.value === 'number' ? v.value : null]),
        smooth: false,
        symbol: 'none',
        lineStyle: { color: '#3b82f6', width: 2 },
        areaStyle: { color: 'rgba(59, 130, 246, 0.08)' },
        connectNulls: false,
      },
    ],
  }
})

function exportCSV () {
  if (!historyData.value?.values?.length) return

  const rows = [['timestamp', 'value', 'quality']]
  for (const v of historyData.value.values) {
    rows.push([v.timestamp, String(v.value ?? ''), v.quality ?? ''])
  }
  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.elementId}-history.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <Card>
    <CardHeader class="pb-3">
      <div class="flex items-center justify-between">
        <CardTitle class="text-base">History</CardTitle>
        <Button
          v-if="historyData?.values?.length"
          variant="ghost"
          size="sm"
          @click="exportCSV"
          title="Export CSV"
        >
          <i class="fa-solid fa-download mr-1"></i>
          CSV
        </Button>
      </div>
    </CardHeader>
    <CardContent>
      <!-- Composition guard -->
      <div v-if="isComposition" class="text-sm text-slate-500">
        <i class="fa-solid fa-info-circle mr-1"></i>
        Select a leaf metric to view history. Compositions do not have direct historical data.
      </div>

      <div v-else>
        <!-- Time range controls -->
        <div class="flex items-center gap-2 mb-3 flex-wrap">
          <Button
            v-for="preset in presets"
            :key="preset.label"
            :variant="selectedPreset === preset.label ? 'default' : 'outline'"
            size="sm"
            @click="selectPreset(preset)"
          >
            {{ preset.label }}
          </Button>
          <Button
            :variant="selectedPreset === 'custom' ? 'default' : 'outline'"
            size="sm"
            @click="selectCustom"
          >
            Custom
          </Button>
          <Button
            size="sm"
            class="ml-auto"
            @click="loadHistory"
            :disabled="loading || (showCustom && (!customStart || !customEnd))"
          >
            <i class="fa-solid fa-clock-rotate-left mr-1"></i>
            Load History
          </Button>
        </div>

        <!-- Custom date inputs -->
        <div v-if="showCustom" class="flex items-center gap-2 mb-3">
          <input
            v-model="customStart"
            type="datetime-local"
            class="px-2 py-1 text-sm border border-border rounded-md"
          />
          <span class="text-sm text-slate-400">to</span>
          <input
            v-model="customEnd"
            type="datetime-local"
            class="px-2 py-1 text-sm border border-border rounded-md"
          />
        </div>

        <!-- Loading -->
        <div v-if="loading" class="flex items-center justify-center py-8 text-slate-400">
          <i class="fa-solid fa-spinner fa-spin mr-2"></i> Loading history...
        </div>

        <!-- Error -->
        <div v-else-if="error" class="text-sm text-red-500 py-4">{{ error }}</div>

        <!-- Chart (numeric data) -->
        <div v-else-if="historyData && isNumeric">
          <Suspense>
            <VChart :option="chartOption" autoresize style="height: 300px" />
            <template #fallback>
              <div class="flex items-center justify-center py-8 text-slate-400">Loading chart...</div>
            </template>
          </Suspense>
        </div>

        <!-- Table (non-numeric data) -->
        <div v-else-if="historyData && historyData.values?.length" class="border rounded-md overflow-hidden max-h-[300px] overflow-y-auto">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 sticky top-0">
              <tr>
                <th class="text-left px-3 py-1.5 font-medium text-slate-600">Timestamp</th>
                <th class="text-left px-3 py-1.5 font-medium text-slate-600">Value</th>
                <th class="text-left px-3 py-1.5 font-medium text-slate-600">Quality</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(v, i) in historyData.values" :key="i" class="border-t">
                <td class="px-3 py-1.5 text-xs text-slate-500">{{ dayjs(v.timestamp).format('YYYY-MM-DD HH:mm:ss') }}</td>
                <td class="px-3 py-1.5 font-mono">{{ v.value ?? '-' }}</td>
                <td class="px-3 py-1.5"><QualityBadge :quality="v.quality" /></td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Empty / not loaded -->
        <div v-else-if="historyData && !historyData.values?.length" class="text-sm text-slate-400 py-4">
          No historical data for this time range.
        </div>
      </div>
    </CardContent>
  </Card>
</template>
```

**Step 2: Register ECharts components**

ECharts needs its components registered. The cleanest way with tree-shaking is to register them in the HistoryPanel or in a shared setup file. Since we want lazy loading, we'll do it inside the component's `<script setup>`:

Add this block to the top of the `<script setup>` in HistoryPanel.vue, before the `VChart` definition:

```js
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, DataZoomComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, DataZoomComponent])
```

Note: Since VChart is loaded via `defineAsyncComponent`, and these `use()` calls are at module scope, they will execute when the module is first imported — which only happens when the Explorer page loads. This gives us both tree-shaking and lazy loading.

**Step 3: Wire into Explorer.vue**

Add below CurrentValue in the main panel:

```vue
<HistoryPanel
  :element-id="store.selectedId"
  :is-composition="store.selectedNode?.isComposition ?? false"
/>
```

**Step 4: Verify** — Select a leaf node, pick a time range, click Load History. See ECharts chart for numeric data or table for non-numeric. Test CSV export downloads a file. Test the data zoom slider. Test composition guard message.

**Step 5: Commit**

```bash
git add src/pages/Explorer/HistoryPanel.vue src/pages/Explorer/Explorer.vue
git commit -m "Add history panel with ECharts time series and CSV export"
```

---

### Task 10: Monitor store and SSE composable

**Files:**
- Create: `acs-admin/src/composables/useI3xSSE.js`
- Create: `acs-admin/src/store/useMonitorStore.js`

**Step 1: Create the SSE composable**

```js
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { fetchEventSource } from '@microsoft/fetch-event-source'

/**
 * Opens a POST-based SSE connection to the i3X subscription stream.
 *
 * @param {string} baseUrl - The i3X API base URL
 * @param {string} clientId
 * @param {string} subscriptionId
 * @param {(items: object[]) => void} onMessage - Called with array of sync items
 * @param {() => void} [onClose] - Called when stream closes
 * @returns {{ close: () => void }} Controller to close the stream
 */
export function openI3xStream (baseUrl, clientId, subscriptionId, onMessage, onClose) {
  const ctrl = new AbortController()

  fetchEventSource(`${baseUrl}/subscriptions/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, subscriptionId }),
    signal: ctrl.signal,

    onmessage (ev) {
      try {
        const items = JSON.parse(ev.data)
        onMessage(items)
      } catch (e) {
        console.warn('Failed to parse SSE data:', e)
      }
    },

    onerror (err) {
      console.error('SSE stream error:', err)
      // Return undefined to let the library retry with default backoff
    },

    onclose () {
      onClose?.()
    },

    // Keep retrying on error
    openWhenHidden: true,
  })

  return {
    close () {
      ctrl.abort()
    },
  }
}
```

**Step 2: Create the monitor store**

```js
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { defineStore } from 'pinia'
import { useI3xClient } from '@composables/useI3xClient.js'
import { openI3xStream } from '@composables/useI3xSSE.js'

function generateClientId () {
  return 'acs-admin-' + crypto.randomUUID()
}

const MAX_TREND_POINTS = 60

export const useMonitorStore = defineStore('monitor', {
  state: () => ({
    clientId: generateClientId(),
    subscriptionId: null,
    /** @type {Map<string, { displayName: string, value: unknown, quality: string|null, timestamp: string|null, trend: Array<{value: number, timestamp: number}> }>} */
    items: new Map(),
    /** Number of new value updates since dialog was last opened */
    newCount: 0,
    dialogOpen: false,
    streaming: false,
    /** @type {{ close: () => void } | null} */
    _streamController: null,
  }),

  getters: {
    hasItems: (state) => state.items.size > 0,
    itemList: (state) => Array.from(state.items.entries()).map(([id, item]) => ({ elementId: id, ...item })),
  },

  actions: {
    async subscribe (elementId, displayName) {
      // Don't double-subscribe
      if (this.items.has(elementId)) return

      const i3x = useI3xClient()

      // Create subscription if we don't have one
      if (!this.subscriptionId) {
        const result = await i3x.createSubscription(this.clientId, 'ACS Admin Monitor')
        this.subscriptionId = result.subscriptionId
      }

      // Register the element
      await i3x.registerItems(this.clientId, this.subscriptionId, [elementId])

      // Add to items
      this.items.set(elementId, {
        displayName,
        value: null,
        quality: null,
        timestamp: null,
        trend: [],
      })

      // Start streaming if not already
      if (!this.streaming) {
        this._startStream()
      }
    },

    async unsubscribe (elementId) {
      if (!this.items.has(elementId)) return

      const i3x = useI3xClient()

      if (this.subscriptionId) {
        await i3x.unregisterItems(this.clientId, this.subscriptionId, [elementId]).catch(() => {})
      }

      this.items.delete(elementId)

      // If no more items, stop streaming and clean up subscription
      if (this.items.size === 0) {
        this._stopStream()
        if (this.subscriptionId) {
          await i3x.deleteSubscription(this.clientId, [this.subscriptionId]).catch(() => {})
          this.subscriptionId = null
        }
      }
    },

    async unsubscribeAll () {
      const i3x = useI3xClient()
      this._stopStream()

      if (this.subscriptionId) {
        await i3x.deleteSubscription(this.clientId, [this.subscriptionId]).catch(() => {})
        this.subscriptionId = null
      }

      this.items.clear()
      this.newCount = 0
    },

    openDialog () {
      this.dialogOpen = true
      this.newCount = 0
    },

    closeDialog () {
      this.dialogOpen = false
    },

    _startStream () {
      if (this.streaming || !this.subscriptionId) return

      const i3x = useI3xClient()
      this.streaming = true

      this._streamController = openI3xStream(
        i3x.baseUrl,
        this.clientId,
        this.subscriptionId,
        (items) => this._handleStreamData(items),
        () => { this.streaming = false },
      )
    },

    _stopStream () {
      if (this._streamController) {
        this._streamController.close()
        this._streamController = null
      }
      this.streaming = false
    },

    _handleStreamData (streamItems) {
      for (const item of streamItems) {
        const existing = this.items.get(item.elementId)
        if (!existing) continue

        existing.value = item.value
        existing.quality = item.quality
        existing.timestamp = item.timestamp

        // Append to trend if numeric
        if (typeof item.value === 'number') {
          existing.trend.push({
            value: item.value,
            timestamp: Date.now(),
          })
          if (existing.trend.length > MAX_TREND_POINTS) {
            existing.trend.shift()
          }
        }

        // Increment new count if dialog is closed
        if (!this.dialogOpen) {
          this.newCount++
        }
      }
    },

    /** Call on beforeunload to clean up server-side resources */
    async cleanup () {
      this._stopStream()
      if (this.subscriptionId) {
        const i3x = useI3xClient()
        // Best-effort cleanup — use sendBeacon if fetch might not complete
        try {
          await i3x.deleteSubscription(this.clientId, [this.subscriptionId])
        } catch {
          // Server TTL will clean up
        }
      }
    },
  },
})
```

**Step 3: Commit**

```bash
git add src/composables/useI3xSSE.js src/store/useMonitorStore.js
git commit -m "Add monitor store and SSE composable for live subscriptions"
```

---

### Task 11: Monitor button and dialog

**Files:**
- Create: `acs-admin/src/components/MonitorButton.vue`
- Create: `acs-admin/src/components/MonitorDialog.vue`
- Modify: `acs-admin/src/App.vue` (add button to navbar + dialog + beforeunload)
- Modify: `acs-admin/src/pages/Explorer/Explorer.vue` (wire subscribe handler)

**Step 1: Create MonitorButton**

```vue
<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { Button } from '@/components/ui/button'
import { useMonitorStore } from '@store/useMonitorStore.js'

const monitor = useMonitorStore()

function handleClick () {
  if (monitor.dialogOpen) {
    monitor.closeDialog()
  } else {
    monitor.openDialog()
  }
}
</script>

<template>
  <Button variant="ghost" size="icon" title="Monitored Items" @click="handleClick" class="relative">
    <i class="fa-solid fa-eye"></i>
    <span
      v-if="monitor.newCount > 0"
      class="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1"
    >
      {{ monitor.newCount > 99 ? '99+' : monitor.newCount }}
    </span>
  </Button>
</template>
```

**Step 2: Create MonitorDialog**

```vue
<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { computed, defineAsyncComponent } from 'vue'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import QualityBadge from '@components/QualityBadge.vue'
import { useMonitorStore } from '@store/useMonitorStore.js'
import dayjs from 'dayjs'

// Lazy-load ECharts for sparklines
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([CanvasRenderer, LineChart, GridComponent])

const VChart = defineAsyncComponent(() =>
  import('vue-echarts').then(m => m.default ?? m)
)

const monitor = useMonitorStore()

function sparklineOption (trend) {
  if (!trend?.length || trend.length < 2) return null
  return {
    grid: { top: 0, right: 0, bottom: 0, left: 0 },
    xAxis: { show: false, type: 'value' },
    yAxis: { show: false, type: 'value' },
    series: [{
      type: 'line',
      data: trend.map((p, i) => [i, p.value]),
      smooth: true,
      symbol: 'none',
      lineStyle: { color: '#3b82f6', width: 1.5 },
      areaStyle: { color: 'rgba(59, 130, 246, 0.1)' },
    }],
  }
}

function formatValue (val) {
  if (val === null || val === undefined) return '-'
  if (typeof val === 'number') return val.toPrecision(6)
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}
</script>

<template>
  <Sheet :open="monitor.dialogOpen" @update:open="(v) => v ? monitor.openDialog() : monitor.closeDialog()">
    <SheetContent side="right" class="overflow-y-auto">
      <SheetHeader>
        <SheetTitle>Monitored Items</SheetTitle>
        <SheetDescription>
          {{ monitor.items.size }} item{{ monitor.items.size === 1 ? '' : 's' }} monitored
          <span v-if="monitor.streaming" class="text-green-500 ml-1">
            <i class="fa-solid fa-circle text-[8px]"></i> Live
          </span>
        </SheetDescription>
      </SheetHeader>

      <div class="mt-4 space-y-3">
        <div v-if="!monitor.hasItems" class="text-sm text-slate-400 py-8 text-center">
          No items being monitored. Use the Subscribe button on a node to start.
        </div>

        <Card v-for="item in monitor.itemList" :key="item.elementId">
          <CardContent class="p-4">
            <div class="flex items-start justify-between mb-2">
              <div>
                <div class="font-medium text-sm">{{ item.displayName }}</div>
                <div class="flex items-center gap-2 mt-1">
                  <span class="font-mono text-lg">{{ formatValue(item.value) }}</span>
                  <QualityBadge :quality="item.quality" />
                </div>
                <div class="text-xs text-slate-400 mt-0.5">
                  {{ item.timestamp ? dayjs(item.timestamp).format('HH:mm:ss') : '-' }}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                class="text-slate-400 hover:text-red-500"
                @click="monitor.unsubscribe(item.elementId)"
                title="Unsubscribe"
              >
                <i class="fa-solid fa-xmark"></i>
              </Button>
            </div>

            <!-- Sparkline -->
            <div v-if="sparklineOption(item.trend)" class="mt-2">
              <Suspense>
                <VChart :option="sparklineOption(item.trend)" autoresize style="height: 40px" />
                <template #fallback><div style="height: 40px"></div></template>
              </Suspense>
            </div>
          </CardContent>
        </Card>
      </div>

      <div v-if="monitor.hasItems" class="mt-4 border-t pt-4">
        <Button variant="outline" size="sm" class="w-full" @click="monitor.unsubscribeAll">
          Unsubscribe All
        </Button>
      </div>
    </SheetContent>
  </Sheet>
</template>
```

**Step 3: Update App.vue — add MonitorButton and MonitorDialog to navbar**

In the header's right-side `<div class="flex items-center justify-center">`, add MonitorButton before SidebarTrigger:

```vue
<MonitorButton/>
<SidebarTrigger/>
```

Add MonitorDialog next to the other dialogs (after NewBridgeDialog):

```vue
<MonitorDialog/>
```

Add imports in the `<script>` block:

```js
import MonitorButton from '@components/MonitorButton.vue'
import MonitorDialog from '@components/MonitorDialog.vue'
```

Register in components:

```js
MonitorButton,
MonitorDialog,
```

Add beforeunload handler in `mounted()`:

```js
window.addEventListener('beforeunload', (e) => {
  const monitor = useMonitorStore()
  if (monitor.hasItems) {
    e.preventDefault()
    monitor.cleanup()
  }
})
```

Add import for monitor store:

```js
import { useMonitorStore } from '@store/useMonitorStore.js'
```

**Step 4: Wire subscribe in Explorer.vue**

Update the `handleSubscribe` function:

```js
import { useMonitorStore } from '@store/useMonitorStore.js'

const monitor = useMonitorStore()

function handleSubscribe () {
  if (store.selectedNode) {
    monitor.subscribe(store.selectedId, store.selectedNode.displayName)
  }
}
```

**Step 5: Verify** — Select a node, click Subscribe. See the monitor button in the navbar. Open the dialog sheet, see the card with name/value/quality. If the device is publishing, see live updates and sparkline building up. Close dialog, see red badge increment. Unsubscribe removes the card.

**Step 6: Commit**

```bash
git add src/components/MonitorButton.vue src/components/MonitorDialog.vue src/App.vue src/pages/Explorer/Explorer.vue
git commit -m "Add monitored items dialog with live SSE updates and sparklines"
```

---

### Task 12: Final integration and polish

**Files:**
- Modify: `acs-admin/src/pages/Explorer/Explorer.vue` (final assembly)

**Step 1: Ensure Explorer.vue has all imports and components wired together**

The final Explorer.vue should have this structure in the main panel:

```vue
<div v-else class="space-y-4">
  <RelationshipGraph
    :element-id="store.selectedId"
    :display-name="store.selectedNode?.displayName"
    @navigate="store.selectNode"
  />
  <CurrentValue
    :element-id="store.selectedId"
    :is-composition="store.selectedNode?.isComposition ?? false"
  />
  <HistoryPanel
    :element-id="store.selectedId"
    :is-composition="store.selectedNode?.isComposition ?? false"
  />
</div>
```

**Step 2: Add copyright headers to all new files if missing**

Every `.vue` and `.js` file should start with:
```
/* Copyright (c) University of Sheffield AMRC 2026. */
```
or the HTML comment equivalent for `.vue` files.

**Step 3: End-to-end verification checklist**

1. Navigate to `/#/explorer` — page loads, tree populates
2. Expand tree nodes — children load lazily
3. Filter — tree filters by name
4. Select a leaf node — sidebar shows metadata, main shows graph + value + history
5. Select a composition — sidebar shows, value shows components table, history shows guard message
6. Relationship graph — renders, depth slider works, click navigates
7. Current value — shows quality badge, refresh works
8. History — presets work, custom range works, chart renders, CSV downloads
9. Subscribe — button adds to monitor store, navbar badge appears
10. Monitor dialog — opens, shows cards with live values and sparklines
11. Close dialog — red badge increments on new data
12. Unsubscribe — removes card, cleans up
13. Page close — beforeunload prompt when monitors active

**Step 4: Commit**

```bash
git add -A
git commit -m "Complete i3X Explorer integration with all components"
```
