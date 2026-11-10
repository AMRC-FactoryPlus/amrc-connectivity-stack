<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Pick devices for the builder. The list comes from i3X, which shows
     each person only the devices they may read, as a tree of their
     ISA-95 levels. Ticking a level takes every device under it that
     the search shows. About 450 devices is normal, so only the first
     MAX_ROWS rows render; "Show more" adds more. Devices already in the
     builder are greyed out. The Selected panel lists the choice and can
     be resized. Emits `add` with the chosen device UUIDs. -->
<template>
  <Dialog :open="open" @update:open="v => emit('update:open', v)">
    <DialogContent class="sm:max-w-[960px] flex flex-col gap-3 h-[80vh] overflow-hidden">
      <DialogHeader>
        <DialogTitle>Add devices</DialogTitle>
        <DialogDescription>Choose devices by where they sit in the ISA-95 hierarchy. Tick a level to take every device under it.</DialogDescription>
      </DialogHeader>

      <div class="flex items-center gap-3">
        <div class="relative flex-1">
          <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400"></i>
          <input v-model="search" type="search" aria-label="Search devices" placeholder="Search by device, ISA-95 level or Sparkplug address..."
                 class="h-9 w-full rounded-md border border-slate-200 pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-slate-950"/>
        </div>
        <Button variant="outline" :disabled="!tree.length || !!search.trim()" @click="toggleAll">{{ allOpen ? 'Collapse all' : 'Expand all' }}</Button>
      </div>

      <div class="flex min-h-0 flex-1 overflow-hidden rounded-md border border-slate-200">
        <div class="min-w-0 flex-1 overflow-y-auto">
          <div v-if="!ds.i3xReady && !ds.i3xDevices.length" class="p-6 text-center text-sm text-slate-500">
            <i class="fa-solid fa-circle-notch animate-spin mr-2"></i>Loading devices
          </div>
          <div v-else-if="ds.i3xError && !ds.i3xDevices.length" class="flex flex-col items-center gap-3 p-6 text-center text-sm text-slate-500">
            {{ ds.i3xError }}
            <Button variant="outline" size="xs" @click="ds.loadI3xDevices()">Try again</Button>
          </div>
          <div v-else-if="!ds.i3xDevices.length" class="p-6 text-center text-sm text-slate-500">
            You can't see any devices in i3X. Ask an administrator for access.
          </div>
          <div v-else-if="!rows.length" class="p-6 text-center text-sm text-slate-500">No devices match "{{ search.trim() }}".</div>
          <PickerTree :items="nested" :ctx="ctx"/>
          <div v-if="rows.length > limit" class="p-3 text-center">
            <Button variant="outline" size="xs" @click="limit += PAGE">
              Show more ({{ rows.length - limit }} more rows)
            </Button>
          </div>
        </div>

        <!-- The choice so far. Drag its left edge, or use the arrow keys on it, to resize. -->
        <div class="relative flex shrink-0 flex-col border-l border-slate-200" :style="{ width: panelW + 'px' }">
          <button type="button" class="absolute -left-[5px] top-0 bottom-0 z-10 w-[9px] cursor-col-resize bg-transparent hover:bg-[linear-gradient(to_right,transparent_3px,#cbd5e1_3px,#cbd5e1_6px,transparent_6px)] focus-visible:bg-[linear-gradient(to_right,transparent_3px,#cbd5e1_3px,#cbd5e1_6px,transparent_6px)] focus-visible:outline-none"
                  aria-label="Resize the selected panel. Use the left and right arrow keys." title="Drag to resize"
                  @pointerdown="startResize" @keydown="resizeKey"></button>
          <div class="flex h-9 shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-4">
            <span class="text-xs font-semibold text-slate-900">Selected</span>
            <button v-if="chosen.size" type="button" class="h-6 rounded px-2 text-xs text-slate-600 hover:bg-slate-100" @click="chosen = new Set()">Clear</button>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto p-2">
            <div v-if="!chosen.size" class="px-3 py-8 text-center text-sm text-slate-500">
              No devices selected yet. Tick a device, or a level to take every device under it.
            </div>
            <div v-for="d in picked" :key="d.uuid" class="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-slate-100">
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[13px] leading-[18px]" :title="d.name">{{ d.name }}</span>
                <span class="block truncate text-[11px] leading-4 text-slate-600" :title="path_label(d.path)">{{ path_label(d.path) }}</span>
              </span>
              <button type="button" class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-200"
                      :aria-label="'Remove ' + d.name" @click="toggle(d.uuid)">
                <i class="fa-solid fa-xmark text-xs"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter class="items-center sm:justify-between">
        <span class="text-sm text-slate-500">{{ chosen.size ? `${chosen.size} selected` : 'Nothing selected' }}</span>
        <div class="flex gap-2">
          <Button variant="outline" @click="emit('update:open', false)">Cancel</Button>
          <Button :disabled="!chosen.size" @click="confirm">
            Add {{ chosen.size || '' }} {{ chosen.size === 1 ? 'device' : 'devices' }}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { ISA95_LEVELS } from '@store/useISA95Store.js'
import { fetch_series } from '@/lib/datasets/api.js'
import { device_status, series_request, LAST_LOOKBACK, LIMITS, DEVICE_STORE } from '@/lib/datasets/series.js'
import { device_gaps, data_rate, fmt_rate } from '@/lib/datasets/gaps.js'
import { text_match, equipment_by_device } from './builder/builder.js'
import { device_tree, tree_rows, nest_rows, path_label } from '@/lib/datasets/i3x-devices.js'
import PickerTree from './PickerTree.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  // Device UUIDs already in the builder.
  added: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:open', 'add'])

const PAGE = 150
const ds = useDatasetsStore()
const search = ref('')
const chosen = ref(new Set())
const limit = ref(PAGE)
const expanded = ref(new Set())

// Start fresh each time the dialog opens, and ask i3X again so a new
// grant shows up.
watch(() => props.open, v => {
  if (!v) return
  search.value = ''
  chosen.value = new Set()
  limit.value = PAGE
  expanded.value = new Set(tree.value.map(n => n.key))
  ds.loadI3xDevices()
})
watch(search, () => { limit.value = PAGE })

const have = computed(() => new Set(props.added))

// The devices i3X shows, with ConfigDB details where they are readable.
const devices = computed(() => {
  const index = ds.deviceIndexByUuid
  return ds.i3xDevices.map(d => index[d.uuid] ?? d)
})
const byUuid = computed(() => Object.fromEntries(devices.value.map(d => [d.uuid, d])))

const tree = computed(() => device_tree(devices.value))

// The top levels start open, so each enterprise shows its sites. The
// tree may arrive after the dialog opens.
watch(tree, t => {
  if (expanded.value.size) return
  expanded.value = new Set(t.map(n => n.key))
}, { immediate: true })

const inEquipment = computed(() => props.open ? equipment_by_device(ds.equipment, ds.byUuid, u => ds.name(u)) : {})

const rows = computed(() => {
  const q = search.value.trim()
  return tree_rows(tree.value, {
    match: q ? d => text_match(q, [d.name, d.sparkplug, d.address, ...(d.path ?? [])]) : null,
    is_open: k => expanded.value.has(k),
  })
})
// Only the first `limit` rows render, nested by level.
const shownRows = computed(() => rows.value.slice(0, limit.value))
const nested = computed(() => nest_rows(shownRows.value))

function levelKeys (nodes) {
  return nodes.flatMap(n => [n.key, ...levelKeys(n.nodes)])
}
const allOpen = computed(() => {
  const keys = levelKeys(tree.value)
  return keys.length > 0 && keys.every(k => expanded.value.has(k))
})

function toggleAll () {
  expanded.value = allOpen.value ? new Set() : new Set(levelKeys(tree.value))
}

function toggleOpen (r) {
  // While searching every matching level is open; the chevron does nothing.
  if (search.value.trim()) return
  const next = new Set(expanded.value)
  next.has(r.node.key) ? next.delete(r.node.key) : next.add(r.node.key)
  expanded.value = next
}

const indent = depth => `${12 + depth * 24}px`
// A level header's height. Headers stack this far apart when they stick.
const ROW_PX = 40

function levelName (r) {
  if (r.node.unplaced) return 'No ISA-95 path'
  return ISA95_LEVELS[r.depth] ?? `Level ${r.depth + 1}`
}

// The devices under a level that can still be added.
const addable = r => r.uuids.filter(u => !have.value.has(u))

function levelState (r) {
  const can = addable(r)
  const got = can.filter(u => chosen.value.has(u)).length
  if (!can.length) return 'disabled'
  return got === can.length ? 'all' : got ? 'some' : 'none'
}

function countOf (r) {
  const n = r.uuids.length
  const got = r.uuids.filter(u => chosen.value.has(u)).length
  return `${got ? got + ' of ' : ''}${n} ${n === 1 ? 'device' : 'devices'}`
}

// A level takes every addable device under it that the search shows,
// or drops them all when it has them all already.
function toggleLevel (r) {
  const can = addable(r)
  const next = new Set(chosen.value)
  const all = can.every(u => next.has(u))
  for (const u of can) all ? next.delete(u) : next.add(u)
  chosen.value = next
}

// What PickerTree needs to draw and act on its rows.
const ctx = {
  ROW_PX,
  indent,
  levelName,
  levelState,
  countOf,
  toggleOpen,
  toggleLevel,
  toggle,
  subOf: d => subOf(d),
  statusOf: d => statusOf(d),
  isAdded: u => have.value.has(u),
  isChosen: u => chosen.value.has(u),
}

const picked = computed(() => [...chosen.value].map(u => byUuid.value[u] ?? { uuid: u, name: u.slice(0, 8), path: [] }))

/* The Selected panel's width. Dragging its left edge left makes it
 * wider. */
const panelW = ref(280)
const setPanelW = w => { panelW.value = Math.max(200, Math.min(520, Math.round(w))) }
let stopResize = null
function startResize (e) {
  e.preventDefault()
  const x0 = e.clientX, w0 = panelW.value
  const move = ev => setPanelW(w0 + (x0 - ev.clientX))
  stopResize = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stopResize)
    stopResize = null
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stopResize)
}
function resizeKey (e) {
  if (e.key === 'ArrowLeft') { e.preventDefault(); setPanelW(panelW.value + 20) }
  if (e.key === 'ArrowRight') { e.preventDefault(); setPanelW(panelW.value - 20) }
}
onBeforeUnmount(() => stopResize?.())

// What a row says under the name. The metric count needs the ConfigDB,
// which not everyone can read.
function subOf (d) {
  const parts = []
  if (Array.isArray(d.metrics)) parts.push(`${d.metrics.length} ${d.metrics.length === 1 ? 'metric' : 'metrics'}`)
  if (rates.value[d.uuid]) parts.push(rates.value[d.uuid])
  if (inEquipment.value[d.uuid]) parts.push(`In ${inEquipment.value[d.uuid].join(', ')}`)
  return parts.join(' · ') || 'Device'
}

/* "Quiet since" and the data rate over the last hour for the devices
 * on screen, fetched once per dialog for each device as it is shown.
 * A device whose request failed is asked again on the next change or
 * after a short wait. Answers from an earlier opening are dropped. */
const RATE_EVERY = '5m'
const RATE_STEP = 5 * 60e3
const RETRY_MS = 15 * 1000
const sc = useServiceClientStore()
const lasts = ref({})
const rates = ref({})
let asked = new Set()
let lastTimer = null
let retryTimer = null
let openGen = 0

watch(() => props.open, v => {
  openGen++
  clearTimeout(retryTimer)
  if (v) { asked = new Set(); lasts.value = {}; rates.value = {} }
})
onBeforeUnmount(() => {
  openGen++
  clearTimeout(lastTimer)
  clearTimeout(retryTimer)
})

const shownUuids = computed(() => shownRows.value.filter(r => r.device).map(r => r.device.uuid))

watch([shownUuids, () => props.open], () => {
  clearTimeout(lastTimer)
  if (!props.open) return
  lastTimer = setTimeout(loadLasts, 300)
})

async function loadLasts () {
  const want = shownUuids.value.filter(u => !asked.has(u)).slice(0, LIMITS.devices)
  if (!want.length || !props.open) return
  const my = openGen
  for (const u of want) asked.add(u)
  // The last hour of closed buckets, so no bucket is mostly empty.
  const to = Math.floor(Date.now() / RATE_STEP) * RATE_STEP
  const from = to - 3600e3
  try {
    // New device datasets read the UNS, so the rate is the UNS's.
    const s = await fetch_series(sc.client, series_request({ devices: want, from, to, every: RATE_EVERY, count: true, last: LAST_LOOKBACK, store: DEVICE_STORE }))
    if (my !== openGen) return
    const got = {}, rate = {}
    for (const u of want) {
      if (s.denied.includes(u)) continue
      got[u] = s.devices[u]?.last ?? null
      const g = device_gaps(s.devices[u]?.count ?? [], { from, to, every: RATE_EVERY, now: s.asOf })
      rate[u] = fmt_rate(data_rate(g, RATE_EVERY))
    }
    lasts.value = { ...lasts.value, ...got }
    rates.value = { ...rates.value, ...rate }
  }
  catch (err) {
    if (my !== openGen) return
    // Status still shows online or offline from the Directory. Ask again.
    console.warn('Datasets: quiet since did not load', err)
    for (const u of want) asked.delete(u)
    clearTimeout(retryTimer)
    retryTimer = setTimeout(loadLasts, RETRY_MS)
  }
}

function statusOf (d) {
  return device_status(d.status, lasts.value[d.uuid])
}

function toggle (uuid) {
  if (have.value.has(uuid)) return
  const next = new Set(chosen.value)
  next.has(uuid) ? next.delete(uuid) : next.add(uuid)
  chosen.value = next
}

function confirm () {
  emit('add', [...chosen.value])
  emit('update:open', false)
}
</script>
