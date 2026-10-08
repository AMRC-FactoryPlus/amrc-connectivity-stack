<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The Data tab: a metric picker on the left and, on the right, one
     chart row per pinned metric over the dataset's window, all on one
     time axis. History comes from Data Access; while the window holds
     now, i3X values extend it live (useDatasetSeries). -->
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
        <div v-else-if="!groups.length" class="p-4 text-center text-sm text-slate-500">No metric matches "{{ query }}".</div>
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
            {{ g.more }} more, search to find them
          </div>
        </div>
      </div>
      <div v-if="missing" class="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
        {{ missing }} {{ missing === 1 ? 'device is' : 'devices are' }} not in the device list, so {{ missing === 1 ? 'its' : 'their' }} metrics are not shown.
      </div>
    </Card>

    <!-- Charts. -->
    <div class="flex min-w-0 flex-[1_1_520px] flex-col gap-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2 font-semibold">
            {{ heading }}
            <span v-if="data.live.value && entries.length" class="inline-flex items-center gap-1 text-xs font-normal text-green-700">
              <span class="size-1.5 rounded-full bg-green-500"></span>Live
            </span>
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

      <Card v-else class="overflow-hidden">
        <!-- Shared time axis. -->
        <div class="grid grid-cols-[200px_minmax(0,1fr)_32px] border-b border-slate-200">
          <div></div>
          <div class="relative h-7 text-[11px] text-slate-500">
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
            <Skeleton v-if="!series && data.loading.value" class="absolute inset-x-0 top-1/2 h-4 -translate-y-1/2"/>
            <div v-else-if="series && !pointsOf(e).length" class="absolute inset-0 flex items-center text-xs text-slate-400">
              No data in this window
            </div>
            <SeriesChart v-else-if="series" :points="pointsOf(e)" :every="series.every" :from="win.from" :to="axisTo" :unit="unitOf(e)"/>
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
import { ref, computed } from 'vue'
import { toast } from 'vue-sonner'
import streamSaver from 'streamsaver'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { fmt_window, fmt_time } from '@/lib/datasets/model.js'
import { metric_count } from '@/lib/datasets/timeline.js'
import { download_csv } from '@/lib/datasets/api.js'
import { axis_ticks, metric_label, chartable, series_key } from '@/lib/datasets/series.js'
import { metric_total, filter_metrics } from './page-logic.js'
import { useDatasetPins } from './usePins.js'
import { useDatasetSeries } from './useDatasetSeries.js'
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

const devices = computed(() => props.resolved.devices.map(d => ds.deviceByUuid[d]).filter(Boolean))
const missing = computed(() => ds.devicesReady ? props.resolved.devices.length - devices.value.length : 0)
const total = computed(() => metric_total(devices.value))

const { pins, entries } = useDatasetPins(() => props.record, () => props.resolved)

// Pinned metrics always show; otherwise the first few, or the matches.
const groups = computed(() => filter_metrics(devices.value, query.value).map(g => {
  const limit = query.value.trim() ? MAX_MATCHES : FIRST
  const shown = g.metrics
    .filter((m, i) => i < limit || pins.has(series_key(g.device.uuid, m.path)))
    .map(m => ({
      path: m.path,
      label: metric_label(m.name),
      unit: m.unit,
      chartable: chartable(m.type),
      pinned: pins.has(series_key(g.device.uuid, m.path)),
    }))
  return { device: g.device, shown, more: g.metrics.length - shown.length }
}))


const data = useDatasetSeries(() => props.record, entries, { points: 300 })
const series = computed(() => data.series.value)
const win = computed(() => data.window.value)

const axisTo = computed(() => data.axisTo.value)
const ticks = computed(() => axis_ticks(win.value.from, axisTo.value, 8))

const heading = computed(() => win.value.windowless
  ? 'Last 24 hours (this dataset has no time window)'
  : fmt_window(props.record.from, props.record.to))

const pointsOf = e => series.value?.metrics[e.key]?.points ?? []
const unitOf = e => series.value?.metrics[e.key]?.unit ?? e.unit ?? ''

const num = v => Math.abs(v) >= 1000 ? v.toFixed(0) : String(+v.toPrecision(4))

/* The text alternative for a chart row: the metric and its newest value. */
function describe (e) {
  const name = `${e.label} on ${e.deviceName}`
  if (!series.value) return `${name}: loading`
  const last = pointsOf(e).at(-1)
  if (!last) return `${name}: no data in this window`
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
