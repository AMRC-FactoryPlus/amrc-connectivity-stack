<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The Datasets timeline, the default view. One track you scroll
     sideways with the labels pinned on the left: ongoing datasets,
     each piece of equipment with its runs, its devices, and every other
     device. Drag across device lanes to select devices and a window,
     then make a dataset from it.

     Up to a few hundred device lanes can be open, so only the lanes,
     ticks and blocks near the view are rendered. Layout maths lives in
     lib/datasets/timeline.js. -->
<template>
  <div class="flex flex-col gap-3">
    <TimelineToolbar v-model:search="query" :zoom="zoom" :label="label" :date-value="dateValue" :now="now"
                     @go="goTo" @step="stepBy" @zoom="setZoom">
      <template #actions><slot name="actions"/></template>
    </TimelineToolbar>

    <!-- Loading -->
    <div v-if="!ds.ready" class="flex flex-col gap-px overflow-hidden rounded-md border border-slate-200 p-3">
      <Skeleton class="mb-2 h-6 w-full"/>
      <div v-for="i in 8" :key="i" class="flex gap-3 py-1.5">
        <Skeleton class="h-6 w-[236px]"/>
        <Skeleton class="h-6 flex-1"/>
      </div>
    </div>

    <template v-else>
      <!-- No equipment yet. Devices are still listed below so they can be selected. -->
      <div v-if="!ds.equipment.length"
           class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <span><i class="fa-solid fa-industry mr-2 text-slate-500"></i>No equipment yet. Equipment groups devices so you can record runs on it.</span>
        <Button size="sm" variant="outline" @click="router.push({ path: '/datasets/new', query: { kind: 'equipment' } })">
          <i class="fa-solid fa-plus mr-1.5"></i>New equipment
        </Button>
      </div>

      <div ref="frame" class="relative select-none overflow-auto rounded-md border border-slate-200 bg-white"
           style="max-height: calc(100vh - 14rem)" @scroll.passive="onScroll">
        <!-- Header: label corner and tick labels -->
        <div class="sticky top-0 z-30 flex border-b border-slate-200 bg-white"
             :style="{ height: `${HEADER_H}px`, width: `${fullWidth}px` }">
          <div class="sticky left-0 z-10 flex shrink-0 items-center border-r border-slate-200 bg-white px-3 text-sm font-medium text-slate-500"
               :style="{ width: `${LABEL_W}px` }">
            Equipment and devices
          </div>
          <div class="relative shrink-0 overflow-hidden text-xs text-slate-500" :style="{ width: `${range.width}px` }">
            <span v-for="t in shownTicks" :key="t.t"
                  class="absolute top-[9px] whitespace-nowrap"
                  :class="t.major ? 'translate-x-1 font-semibold' : '-translate-x-1/2'"
                  :style="{ left: `${t.x}px` }">{{ t.label }}</span>
            <span v-if="nowX != null"
                  class="absolute top-[11px] z-[1] whitespace-nowrap rounded bg-slate-900 px-1 text-[10px] font-bold text-slate-50"
                  :style="{ left: `${nowX + 4}px` }">Now {{ fmt_clock(now) }}</span>
          </div>
        </div>

        <!-- Lanes -->
        <div ref="lanes" class="relative" :style="{ height: `${layout.height}px`, width: `${fullWidth}px` }"
             @pointerdown="onPointerDown">
          <!-- Gridlines, future, now and selection sit over the track. -->
          <div class="pointer-events-none absolute inset-y-0" :style="{ left: `${LABEL_W}px`, width: `${range.width}px` }">
            <span v-for="t in shownTicks" :key="t.t" class="absolute inset-y-0 z-[1] w-px"
                  :class="t.major ? 'bg-slate-400' : 'bg-[#eef2f6]'" :style="{ left: `${t.x}px` }"></span>
            <div v-if="futureX < range.width" class="absolute inset-y-0 z-[2]"
                 :style="{ left: `${futureX}px`, width: `${range.width - futureX}px`, background: FUTURE_HATCH }">
              <span class="sticky left-[272px] ml-[72px] mt-1.5 inline-block text-[11px] text-slate-500">
                Future. No data yet. Selections here make a dataset that fills in as data arrives.
              </span>
            </div>
            <div v-if="nowX != null" class="absolute inset-y-0 z-[4] w-0.5 bg-slate-900" :style="{ left: `${nowX}px` }"></div>
            <div v-if="selection" class="absolute z-[5] rounded border-2 border-dashed border-slate-900 bg-slate-900/[.06]"
                 :style="{ top: `${selection.top}px`, height: `${selection.height}px`, left: `${selX.left}px`, width: `${Math.max(2, selX.right - selX.left)}px` }"></div>
          </div>

          <template v-for="row in shownRows" :key="row.key">
            <DeviceLane v-if="row.kind === 'device'" :row="row" :track-width="range.width"/>
            <TimelineLane v-else :row="row" :track-width="range.width"
                          :blocks="row.kind === 'equipment' ? placed(row.uuid) : undefined"
                          @toggle="toggle"/>
          </template>

          <!-- On the page, not in the frame, so the frame's scroll area
               cannot clip it. -->
          <Teleport to="body">
            <SelectionCard v-if="selection && !sel.dragging" class="fixed z-50"
                           :style="{ top: `${cardPos.top}px`, left: `${cardPos.left}px` }"
                           :from="selection.from" :to="selection.to" :summary="summary" :now="now"
                           @close="sel = null" @make="makeDataset"/>
          </Teleport>
        </div>
      </div>

      <div v-if="query.trim() && !layout.matched" class="p-6 text-center text-sm text-gray-500">
        No equipment or devices match "{{ query.trim() }}".
      </div>

      <TimelineLegend/>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useEventListener, useNow, useResizeObserver } from '@vueuse/core'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import {
  ZOOMS, track_range, ticks, centre_label, snap, fmt_clock, london_date_key,
} from '@/lib/datasets/model.js'
import {
  LABEL_W, HEADER_H,
  x_of, t_of, scroll_left_for, view_centre, in_track, visible_x, visible_ticks,
  equipment_devices, build_rows, row_at, visible_rows,
  equipment_blocks, place_blocks, resolve_selection, selection_summary, make_dataset_query,
} from '@/lib/datasets/timeline.js'
import TimelineToolbar from '@/components/Datasets/timeline/TimelineToolbar.vue'
import TimelineLane from '@/components/Datasets/timeline/TimelineLane.vue'
import DeviceLane from '@/components/Datasets/timeline/DeviceLane.vue'
import SelectionCard from '@/components/Datasets/timeline/SelectionCard.vue'
import TimelineLegend from '@/components/Datasets/timeline/TimelineLegend.vue'

const ds = useDatasetsStore()
const router = useRouter()

const FUTURE_HATCH = 'repeating-linear-gradient(135deg, rgba(241,245,249,0.7) 0 6px, rgba(248,250,252,0.7) 6px 12px)'
const MIN_SELECTION_MS = 5 * 60 * 1000

/* ------------------------------------------------------------------
 * View state. Zoom and open groups are remembered in this browser.
 * ------------------------------------------------------------------ */

const STORE_KEY = 'acs-admin.datasets.timeline'

function load () {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') ?? {} }
  catch { return {} }
}
const saved = load()

const zoom = ref(saved.zoom in ZOOMS ? saved.zoom : 'hours')
const expanded = ref(saved.expanded && typeof saved.expanded === 'object' ? saved.expanded : {})
const query = ref('')

watch([zoom, expanded], () => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ zoom: zoom.value, expanded: expanded.value })) }
  catch { /* storage blocked: the view still works */ }
}, { deep: true })

const nowDate = useNow({ interval: 30 * 1000 })
const now = computed(() => nowDate.value.getTime())

// The time the track is built around. It changes only when the track
// is rebuilt; scrolling moves the view, not the track.
const centre = ref(Date.now())
const range = computed(() => track_range(zoom.value, centre.value))
const allTicks = computed(() => ticks(zoom.value, range.value))
const fullWidth = computed(() => LABEL_W + range.value.width)

/* ------------------------------------------------------------------
 * Scroll position, read once per frame.
 * ------------------------------------------------------------------ */

const frame = ref(null)
const view = reactive({ left: 0, top: 0, width: 1200, height: 600 })

function readView () {
  const el = frame.value
  if (!el) return
  view.left = el.scrollLeft
  view.top = el.scrollTop
  view.width = el.clientWidth
  view.height = el.clientHeight
}

let raf = 0
function onScroll () {
  if (raf) return
  raf = requestAnimationFrame(() => { raf = 0; readView() })
}
onBeforeUnmount(() => cancelAnimationFrame(raf))
useResizeObserver(frame, readView)

const xWindow = computed(() => visible_x(view.left, view.width))
const shownTicks = computed(() => visible_ticks(allTicks.value, xWindow.value.x0, xWindow.value.x1))
const viewCentre = computed(() => view_centre(range.value, view.left, view.width))
const label = computed(() => centre_label(zoom.value, viewCentre.value, now.value))
const dateValue = computed(() => london_date_key(viewCentre.value))

const nowX = computed(() => {
  const r = range.value
  return now.value >= r.start && now.value <= r.end ? x_of(now.value, r) : null
})
const futureX = computed(() => Math.max(0, Math.min(range.value.width, x_of(now.value, range.value))))

/* ------------------------------------------------------------------
 * Moving through time
 * ------------------------------------------------------------------ */

function scrollTo (t, smooth) {
  const el = frame.value
  if (!el) return
  const left = scroll_left_for(t, range.value, el.clientWidth)
  if (smooth) el.scrollTo({ left, behavior: 'smooth' })
  else el.scrollLeft = left
  readView()
}

// Where to scroll once the frame exists (it is not rendered while loading).
let pending = Date.now()

async function goTo (t) {
  sel.value = null
  if (frame.value && in_track(t, range.value)) {
    scrollTo(t, true)
    return
  }
  // Rebuild the track around t, then put t in the middle.
  centre.value = t
  pending = t
  await nextTick()
  if (frame.value) { scrollTo(t, false); pending = null }
}

function stepBy (dir) {
  goTo(viewCentre.value + dir * ZOOMS[zoom.value].step)
}

async function setZoom (z) {
  if (!(z in ZOOMS) || z === zoom.value) return
  const c = frame.value ? viewCentre.value : (pending ?? now.value)
  sel.value = null
  zoom.value = z
  centre.value = c
  pending = c
  await nextTick()
  if (frame.value) { scrollTo(c, false); pending = null }
}

// Start centred on now, once the frame first appears.
watch(frame, el => {
  if (!el || pending == null) return
  const t = pending
  nextTick(() => { scrollTo(t, false); pending = null })
}, { flush: 'post' })

/* ------------------------------------------------------------------
 * Lanes
 * ------------------------------------------------------------------ */

// Datasets with no window at all. Equipment has its own lanes.
const ongoing = computed(() => ds.visible
  .filter(r => !r.from && !r.to && r.kind !== 'equipment' && r.kind !== 'device' && !r.invalid)
  .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  .map(record => ({ record, devices: ds.devicesOf(record.uuid).devices.length })))

const eqDevices = computed(() => equipment_devices(ds.equipment, u => ds.devicesOf(u), ds.byUuid))

const layout = computed(() => build_rows({
  ongoing: ongoing.value,
  equipment: ds.equipment,
  eq_devices: eqDevices.value,
  devices: ds.devices,
  expanded: expanded.value,
  query: query.value,
}))

const shownRows = computed(() => visible_rows(layout.value.rows, view.top, view.height))

function toggle (row) {
  sel.value = null
  expanded.value = { ...expanded.value, [row.uuid ?? row.key]: !row.open }
}

// Blocks per equipment, then placed for the visible stretch of track.
const blocksByEquipment = computed(() => {
  const out = {}
  for (const e of ds.equipment) {
    out[e.uuid] = equipment_blocks(e, ds.runsByEquipment[e.uuid] ?? [], ds.recordings[e.uuid] ?? null, now.value)
  }
  return out
})

function placed (uuid) {
  return place_blocks(blocksByEquipment.value[uuid] ?? [], range.value, xWindow.value.x0, xWindow.value.x1, view.left)
}

/* ------------------------------------------------------------------
 * Selection: press on a device lane and drag across lanes and time.
 * ------------------------------------------------------------------ */

// { k0, k1 } row keys, { t0, t1 } times as dragged, `dragging`.
const sel = ref(null)

const selection = computed(() => resolve_selection(sel.value, layout.value.rows))
const selX = computed(() => selection.value
  ? { left: x_of(selection.value.from, range.value), right: x_of(selection.value.to, range.value) }
  : { left: 0, right: 0 })
const summary = computed(() => selection_summary(selection.value?.devices ?? [], ds.deviceByUuid))

/* Where the selection card goes on screen: beside the selection, on
 * whichever side has room in the window, and kept inside the window.
 * It follows the frame's scroll (view) and the page's (winTick). */
const lanes = ref(null)
const winTick = ref(0)
const bumpWin = () => { winTick.value++ }
window.addEventListener('scroll', bumpWin, { passive: true, capture: true })
window.addEventListener('resize', bumpWin, { passive: true })
onBeforeUnmount(() => {
  window.removeEventListener('scroll', bumpWin, { capture: true })
  window.removeEventListener('resize', bumpWin)
})
const cardPos = computed(() => {
  void view.left; void view.top; void winTick.value
  const CARD_W = 300, CARD_H = 260, GAP = 12, EDGE = 8
  const el = lanes.value
  if (!el || !selection.value) return { left: 0, top: 0 }
  const r = el.getBoundingClientRect()
  const right = r.left + LABEL_W + selX.value.right + GAP
  const left = r.left + LABEL_W + selX.value.left - GAP - CARD_W
  const maxX = window.innerWidth - CARD_W - EDGE
  const x = right <= maxX ? right : left >= EDGE ? left : maxX
  const y = r.top + selection.value.top
  return {
    left: Math.max(EDGE, Math.min(maxX, x)),
    top: Math.max(EDGE, Math.min(window.innerHeight - CARD_H - EDGE, y)),
  }
})

function pointer (e) {
  const el = frame.value
  const rect = el.getBoundingClientRect()
  const vx = e.clientX - rect.left
  return {
    vx,
    x: vx + el.scrollLeft - LABEL_W,
    y: e.clientY - rect.top + el.scrollTop - HEADER_H,
  }
}

function rowKeyAt (y) {
  const rows = layout.value.rows
  if (!rows.length) return null
  const yy = Math.max(0, Math.min(layout.value.height - 1, y))
  const i = row_at(rows, yy)
  return rows[i < 0 ? rows.length - 1 : i].key
}

function onPointerDown (e) {
  if (e.button !== 0 || !frame.value) return
  if (e.target.closest?.('a, button, [data-no-drag]')) return
  const p = pointer(e)
  if (p.vx < LABEL_W) return
  const i = row_at(layout.value.rows, p.y)
  const row = layout.value.rows[i]
  if (!row || row.kind !== 'device') { sel.value = null; return }
  e.preventDefault()
  const t = snap(t_of(p.x, range.value))
  sel.value = { k0: row.key, k1: row.key, t0: t, t1: t, dragging: true }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp, { once: true })
  window.addEventListener('pointercancel', onPointerUp, { once: true })
}

function onPointerMove (e) {
  if (!sel.value?.dragging || !frame.value) return
  const p = pointer(e)
  const k1 = rowKeyAt(p.y)
  if (!k1) return
  sel.value = { ...sel.value, k1, t1: snap(t_of(p.x, range.value)) }
}

function onPointerUp () {
  stopDrag()
  if (!sel.value) return
  // A click, not a drag.
  if (Math.abs(sel.value.t1 - sel.value.t0) < MIN_SELECTION_MS) { sel.value = null; return }
  sel.value = { ...sel.value, dragging: false }
}

function stopDrag () {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}
onBeforeUnmount(stopDrag)

useEventListener(window, 'keydown', e => {
  if (e.key === 'Escape' && sel.value) sel.value = null
})

// A search or a change in the lanes can remove the selected rows.
watch(query, () => { sel.value = null })

function makeDataset () {
  if (!selection.value?.devices.length) return
  router.push({ path: '/datasets/new', query: make_dataset_query(selection.value) })
}
</script>
