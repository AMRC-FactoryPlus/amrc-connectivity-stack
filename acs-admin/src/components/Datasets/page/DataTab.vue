<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The Data tab: a metric picker on the left and, on the right, one
     chart row per pinned metric, all on one time axis. The toolbar,
     dragging and sideways scrolling move the view; it starts on the
     dataset's window. History comes from Data Access; while the view
     includes now it keeps updating, and at fine zoom i3X values extend
     it as they arrive (useChartSeries). -->
<template>
  <div v-if="!record.structure" class="py-8 text-center text-sm text-slate-500">
    Structure is visible to people who can edit this dataset, so the metric list is not available.
  </div>

  <div v-else class="flex flex-wrap items-start gap-4">
    <!-- Metric picker. -->
    <Card class="flex w-full flex-col overflow-hidden md:sticky md:top-4 md:max-h-[calc(100vh-14rem)] md:w-[300px] md:shrink-0">
      <div class="border-b border-slate-200 p-3">
        <div class="relative">
          <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" aria-hidden="true"></i>
          <input v-model="query" type="search" aria-label="Search metrics" :placeholder="`Search ${total} metrics...`"
                 class="h-9 w-full rounded-md border border-slate-200 pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-slate-950"/>
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div v-if="!devices.length" class="p-4 text-center text-sm text-slate-500">
          {{ resolved.devices.length ? 'The device details are still loading.' : 'This dataset covers no devices.' }}
        </div>
        <div v-else-if="!groups.length" class="p-4 text-center text-sm text-slate-500">No metric matches "{{ search }}".</div>
        <div v-for="g in groups" :key="g.device.uuid" class="border-b border-slate-100 py-2 last:border-b-0">
          <div class="flex items-center justify-between gap-2 px-3 pb-1 text-[13px]">
            <span class="truncate font-semibold" :title="g.device.name">{{ g.device.name }}</span>
            <span class="shrink-0 text-xs text-slate-500">{{ metric_count(g.device.metrics.length) }}</span>
          </div>
          <div v-if="!g.device.metrics.length" class="px-3 text-xs text-slate-500">Records no metrics to the historian.</div>
          <label v-for="m in g.shown" :key="m.path"
                 class="flex items-center gap-2 px-3 py-1 text-[13px]"
                 :class="m.chartable ? 'cursor-pointer hover:bg-slate-50' : 'cursor-default text-slate-400'"
                 :title="m.path">
            <input type="checkbox" class="size-3.5 shrink-0 accent-slate-900"
                   :checked="m.pinned" :disabled="!m.chartable"
                   @change="pins.toggle(g.device.uuid, m.path)"/>
            <span class="min-w-0 flex-1 truncate">{{ m.label }}</span>
            <span v-if="!m.chartable" class="shrink-0 text-xs text-slate-500">Text, not charted</span>
            <span v-else-if="m.unit" class="shrink-0 text-xs text-slate-400">{{ m.unit }}</span>
          </label>
          <div v-if="g.more" class="px-3 pt-1 text-xs text-slate-500">
            {{ g.more }} more, {{ search.trim() ? 'narrow the search to see them' : 'search to find them' }}
          </div>
        </div>
      </div>
      <div v-if="missing" class="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
        {{ missing }} {{ missing === 1 ? 'device is' : 'devices are' }} not in the device list, so {{ missing === 1 ? 'its' : 'their' }} metrics are not shown.
      </div>
    </Card>

    <!-- Charts. -->
    <div ref="chartsEl" class="flex min-w-0 flex-[1_1_520px] flex-col gap-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2 font-semibold">
            {{ heading }}
            <span v-if="data.live.value && entries.length" class="inline-flex items-center gap-1 text-xs font-normal text-green-700">
              <span class="size-1.5 rounded-full bg-green-500"></span>Live
            </span>
            <span v-if="data.live.value && entries.length && data.hint.value" class="text-xs font-normal text-slate-400">{{ data.hint.value }}</span>
          </div>
          <div class="text-[13px] text-slate-500">Pinned metrics change this view and the CSV download. They do not change the dataset.</div>
        </div>
        <div class="flex shrink-0 gap-2">
          <Button size="sm" variant="ghost" :disabled="!pins.keys.value.length" @click="pins.clear()">Clear pins</Button>
          <Button size="sm" variant="outline" :disabled="!entries.length || pinnedDownloading" @click="downloadPinned">
            <i :class="['fa-solid mr-2', pinnedDownloading ? 'fa-circle-notch animate-spin' : 'fa-download']"></i>Download pinned only
          </Button>
        </div>
      </div>

      <div v-if="data.error.value" class="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
        <i class="fa-solid fa-triangle-exclamation mr-2"></i>{{ data.error.value }}
      </div>

      <p v-if="data.meanNote.value" class="text-xs text-slate-500">
        <i class="fa-solid fa-circle-info mr-1"></i>{{ data.meanNote.value }}
      </p>

      <Card v-if="!entries.length" class="px-4 py-10 text-center text-sm text-slate-500">
        <i class="fa-solid fa-thumbtack mb-2 block text-slate-400"></i>
        Pin metrics on the left to chart them here.
      </Card>

      <div v-if="entries.length" class="flex flex-wrap items-center gap-2">
        <TimelineToolbar :zoom="labels.zoom ?? ''" :label="labels.label" :date-value="labels.dateValue" :now="data.now.value"
                         :searchable="false" :minutes="true" :step-text="stepText"
                         @go="t => setView(go_view(current, t, maxTo))"
                         @step="d => setView(step_view(current, d, maxTo))"
                         @zoom="z => setView(zoom_view(current, z, chartW, maxTo, nowMs, { live: takesLive, window: win }))"/>
        <span class="text-xs text-slate-500">{{ labels.span }} shown</span>
        <Button v-if="takesLive && !at_now(current, nowMs, stepMs)" size="sm" variant="ghost" @click="setView(to_now(current, Date.now()))">Back to now</Button>
        <Button v-else-if="!takesLive && view" size="sm" variant="ghost" @click="view = null">Whole window</Button>
      </div>

      <Card v-if="entries.length" class="touch-pan-y select-none overflow-hidden"
            :class="dragging ? 'cursor-grabbing' : 'cursor-grab'"
            @pointerdown="startDrag" @wheel="onWheel">
        <!-- Shared time axis. Drag or scroll sideways to move along it. -->
        <div class="grid grid-cols-[200px_minmax(0,1fr)_32px] border-b border-slate-200">
          <div></div>
          <div class="relative h-7 text-[11px] text-slate-500">
            <span v-if="future" class="pointer-events-none absolute inset-y-0 right-0" :style="{ left: `${future.frac * 100}%`, background: FUTURE_HATCH }"></span>
            <span v-for="t in ticks" :key="t.t" class="absolute top-1.5 -translate-x-1/2 whitespace-nowrap"
                  :class="t.major && 'font-semibold'" :style="{ left: `${t.frac * 100}%` }">{{ t.label }}</span>
          </div>
          <div></div>
        </div>

        <div v-for="e in entries" :key="e.key"
             class="grid h-[72px] grid-cols-[200px_minmax(0,1fr)_32px] items-center border-b border-slate-100 last:border-b-0">
          <div class="min-w-0 px-3">
            <div class="truncate text-[13px] font-semibold" :title="e.path">{{ e.label }}</div>
            <div class="truncate text-xs text-slate-500">{{ e.deviceName }}{{ unitOf(e) ? ` · ${unitOf(e)}` : '' }}</div>
          </div>
          <div class="relative h-full min-w-0" role="img" :aria-label="describe(e)">
            <span v-for="t in ticks" :key="t.t" class="pointer-events-none absolute inset-y-0 w-px bg-slate-100"
                  :style="{ left: `${t.frac * 100}%` }"></span>
            <!-- The part of the window still to come, and now. -->
            <template v-if="future">
              <span class="pointer-events-none absolute inset-y-0 right-0" :style="{ left: `${future.frac * 100}%`, background: FUTURE_HATCH }"></span>
              <span class="pointer-events-none absolute inset-y-0 z-10 w-px bg-slate-900" :style="{ left: `${future.frac * 100}%` }" title="Now"></span>
            </template>
            <Skeleton v-if="!series && data.loading.value" class="absolute inset-x-0 top-1/2 h-4 -translate-y-1/2"/>
            <div v-else-if="series && !shown[e.key]?.rows.length" class="absolute inset-0 flex items-center text-xs text-slate-400">
              {{ data.loading.value ? 'Loading' : 'No data in this view' }}
            </div>
            <SeriesChart v-else-if="series" :rows="shown[e.key].rows" :step="shown[e.key].step" :from="current.from" :to="current.to" :unit="unitOf(e)"/>
          </div>
          <button type="button" class="flex size-8 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
                  :title="`Unpin ${e.label}`" @click="pins.unpin(e.key)">
            <i class="fa-solid fa-xmark text-xs"></i><span class="sr-only">Unpin {{ e.label }}</span>
          </button>
        </div>
      </Card>

      <p v-if="data.capped.value" class="text-xs text-slate-500">
        Charts show the first 50 pinned metrics. Unpin some to see the rest.
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { useElementSize, refDebounced } from '@vueuse/core'
import { toast } from 'vue-sonner'
import streamSaver from 'streamsaver'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { fmt_window, fmt_time, fmt_duration } from '@/lib/datasets/model.js'
import { metric_count } from '@/lib/datasets/timeline.js'
import { download_csv } from '@/lib/datasets/api.js'
import { axis_ticks, chartable, series_key, latest_point, device_metric_labels, fmt_since, STEP_MS } from '@/lib/datasets/series.js'
import { metric_total, filter_metrics } from './page-logic.js'
import { useDatasetPins } from './usePins.js'
import { useChartSeries } from './useChartSeries.js'
import TimelineToolbar from '../timeline/TimelineToolbar.vue'
import { go_view, step_view, zoom_view, pan_view, view_labels, at_now, to_now } from '@/lib/datasets/chart-view.js'
import SeriesChart from './SeriesChart.vue'

const props = defineProps({
  record: { type: Object, required: true },
  resolved: { type: Object, required: true },
  downloading: { type: Boolean, default: false },
})
defineEmits(['download'])

const FIRST = 6
const MAX_MATCHES = 50

const ds = useDatasetsStore()
const sc = useServiceClientStore()
const query = ref('')
// Filter once typing pauses, not on every key.
const search = refDebounced(query, 200)
// At most this many metric rows render at once, across all devices.
const MAX_ROWS = 300

const devices = computed(() => props.resolved.devices.map(d => ds.deviceByUuid[d]).filter(Boolean))
const missing = computed(() => ds.devicesReady ? props.resolved.devices.length - devices.value.length : 0)
const total = computed(() => metric_total(devices.value))

const { pins, entries } = useDatasetPins(() => props.record, () => props.resolved)

// Pinned metrics always show; otherwise the first few, or the matches,
// up to MAX_ROWS in all.
const groups = computed(() => {
  let room = MAX_ROWS
  return filter_metrics(devices.value, search.value).map(g => {
    const limit = Math.max(0, Math.min(room, search.value.trim() ? MAX_MATCHES : FIRST))
    const labels = device_metric_labels(g.device.metrics)
    const shown = g.metrics
      .filter((m, i) => i < limit || pins.has(series_key(g.device.uuid, m.path)))
      .map(m => ({
        path: m.path,
        label: labels.get(m.path),
        unit: m.unit,
        chartable: chartable(m.type),
        pinned: pins.has(series_key(g.device.uuid, m.path)),
      }))
    room -= shown.length
    return { device: g.device, shown, more: g.metrics.length - shown.length }
  })
})


// Each chart is the charts column less its label and unpin columns.
const LABEL_PX = 200 + 32
const chartsEl = ref(null)
const { width: chartsWidth } = useElementSize(chartsEl)
const chartW = computed(() => chartsWidth.value ? Math.max(200, chartsWidth.value - LABEL_PX) : 600)

/* The range in view. Null shows the dataset's window (for one with no
 * window, the last 24 hours; while recording, this recording). Moving
 * it sets a range; a range that ends at now keeps ending at now. */
const view = ref(null)
const data = useChartSeries(() => props.record, entries, {
  view: () => view.value ? effective(view.value) : null,
  width: chartW,
})
const series = computed(() => data.series.value)
const win = computed(() => data.window.value)
const nowMs = computed(() => data.now.value)

function effective (v) {
  return v.follow ? { from: nowMs.value - v.span, to: nowMs.value } : v
}
const current = computed(() => view.value ? effective(view.value) : { from: win.value.from, to: win.value.to })
// The dataset takes live data: no window, or one that includes now.
// Then a zoom change goes to now.
const takesLive = computed(() => win.value.windowless || win.value.open || (win.value.from <= nowMs.value && win.value.to >= nowMs.value))
// One bucket, the tolerance for "ends at now".
const stepMs = computed(() => STEP_MS[data.every.value] ?? 0)
// A view can run up to now, or to the end of a window that ends later.
const maxTo = computed(() => Math.max(nowMs.value, win.value.to))

function setView (v) {
  const span = v.to - v.from
  const n = Date.now()
  view.value = Math.abs(v.to - n) <= span * 0.02 ? { follow: true, span } : { from: v.from, to: v.to }
}

const labels = computed(() => view_labels(current.value, chartW.value, nowMs.value))
const stepText = computed(() => `${fmt_duration(current.value.to - current.value.from)}`)
const ticks = computed(() => axis_ticks(current.value.from, current.value.to, 8))

// What each chart draws, worked out once per change.
const shown = computed(() => {
  void series.value
  return Object.fromEntries(entries.value.map(e => [e.key, data.display(e.key)]))
})

/* Drag or scroll sideways to move along the time axis. */
const dragging = ref(false)
let dragX = null
function startDrag (ev) {
  if (ev.button !== 0 || ev.target.closest('button')) return
  dragX = ev.clientX
  dragging.value = true
  window.addEventListener('pointermove', onDrag)
  window.addEventListener('pointerup', stopDrag)
  window.addEventListener('pointercancel', stopDrag)
}
function onDrag (ev) {
  if (dragX == null) return
  const dx = ev.clientX - dragX
  if (!dx) return
  dragX = ev.clientX
  setView(pan_view(current.value, dx, chartW.value, maxTo.value))
}
function stopDrag () {
  dragX = null
  dragging.value = false
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', stopDrag)
  window.removeEventListener('pointercancel', stopDrag)
}
onBeforeUnmount(stopDrag)
function onWheel (ev) {
  if (Math.abs(ev.deltaX) <= Math.abs(ev.deltaY)) return
  ev.preventDefault()
  setView(pan_view(current.value, -ev.deltaX, chartW.value, maxTo.value))
}

const heading = computed(() => {
  if (win.value.recording != null) return `Recording now, since ${fmt_since(win.value.recording)} (this will be saved as a run when it stops)`
  if (win.value.windowless) return 'Last 24 hours (this dataset has no time window)'
  return fmt_window(props.record.from, props.record.to)
})

// Same hatch as the timeline uses for time still to come.
const FUTURE_HATCH = 'repeating-linear-gradient(135deg, rgba(241,245,249,0.7) 0 6px, rgba(248,250,252,0.7) 6px 12px)'
// Where now falls on the axis, when the view runs past now.
const future = computed(() => {
  const now = nowMs.value, { from, to } = current.value
  if (!(now > from && now < to)) return null
  return { frac: (now - from) / (to - from) }
})

const unitOf = e => series.value?.metrics[e.key]?.unit ?? e.unit ?? ''

const num = v => Math.abs(v) >= 1000 ? v.toFixed(0) : String(+v.toPrecision(4))

/* The text alternative for a chart row: the metric and its newest value. */
function describe (e) {
  const name = `${e.label} on ${e.deviceName}`
  if (!series.value) return `${name}: loading`
  const last = latest_point(series.value.metrics[e.key])
  if (!last) return `${name}: no data in this view`
  const unit = unitOf(e)
  return `${name}: latest ${num(last[1])}${unit ? ` ${unit}` : ''} at ${fmt_time(last[0])}`
}

const pinnedDownloading = ref(false)
async function downloadPinned () {
  if (pinnedDownloading.value) return
  pinnedDownloading.value = true
  try {
    await download_csv(sc.client, props.record.uuid, streamSaver, { metrics: [...new Set(entries.value.map(e => e.path))] })
    toast.success('Download complete')
  }
  catch (err) {
    console.error('Pinned CSV download failed', err)
    toast.error('Download failed', { description: err?.message ?? 'The service did not return the data.' })
  }
  finally {
    pinnedDownloading.value = false
  }
}
</script>
