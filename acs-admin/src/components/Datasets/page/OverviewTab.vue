<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The Overview tab: a live card while recording, the stats, what the
     dataset holds (recordings, runs, devices), and a side column with
     add-ons, shortcuts and what includes it. -->
<template>
  <div class="flex flex-col gap-4">
    <Card v-if="recording" class="flex flex-wrap items-center gap-4 px-5 py-4">
      <span class="size-2.5 rounded-full bg-green-500 animate-pulse"></span>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold text-green-600">Recording now</div>
        <div class="text-sm text-slate-500">
          Started {{ fmt_time(recording.startedAt) }}<template v-if="recording.startedBy"> by {{ recording.startedBy }}</template>.
          Held on the server until it is stopped, so closing this page is safe.
        </div>
      </div>
      <div class="text-3xl font-semibold tabular-nums tracking-tight">{{ elapsed }}</div>
    </Card>

    <div class="flex flex-wrap items-start gap-4">
      <!-- Main column. -->
      <div class="flex min-w-0 flex-[3_1_520px] flex-col gap-4">
        <p v-if="record.run?.description" class="text-slate-700">{{ record.run.description }}</p>
        <div v-if="record.run?.note" class="text-sm text-slate-700">
          <i class="fa-solid fa-note-sticky mr-1 text-slate-500"></i>Note: {{ record.run.note }}
        </div>

        <Card class="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] overflow-hidden">
          <div v-for="s in stats" :key="s.label" class="min-w-0 border-r border-slate-200 px-4 py-3 last:border-r-0">
            <div class="text-xs text-slate-500">{{ s.label }}</div>
            <div class="truncate text-xl font-semibold tabular-nums tracking-tight" :title="s.value">{{ s.value }}</div>
            <div class="truncate text-xs" :class="s.subCls ?? 'text-slate-500'" :title="s.sub">{{ s.sub }}</div>
          </div>
        </Card>

        <RecordingsCard v-if="record.kind === 'equipment'" :record="record"/>

        <Card v-if="isGroup" class="flex flex-col gap-3 p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="font-semibold">Runs <span class="font-normal text-slate-500">{{ items.length }}</span></span>
            <Button v-if="items.length > 1" size="sm" as-child>
              <RouterLink :to="`/datasets/compare?ids=${items.join(',')}`">
                <i class="fa-solid fa-code-compare mr-2"></i>Compare these runs
              </RouterLink>
            </Button>
            <Button v-else size="sm" disabled title="Needs at least two runs">
              <i class="fa-solid fa-code-compare mr-2"></i>Compare these runs
            </Button>
          </div>
          <div v-if="!record.structure" class="text-sm text-slate-500">Structure is visible to people who can edit this dataset.</div>
          <div v-else-if="!items.length" class="text-sm text-slate-500">This {{ record.kind }} has no runs.</div>
          <div v-else class="overflow-x-auto rounded-md border border-slate-200">
            <table class="w-full text-sm">
              <thead class="bg-slate-50 text-left text-xs text-slate-500">
                <tr><th class="px-4 py-2 font-medium">Run</th><th class="px-4 py-2 font-medium">Window</th><th class="px-4 py-2 font-medium">Duration</th></tr>
              </thead>
              <tbody>
                <tr v-for="id in items" :key="id" class="cursor-pointer border-t border-slate-100 hover:bg-slate-50" @click="router.push(`/datasets/${id}`)">
                  <td class="px-4 py-2 font-medium">
                    <RouterLink :to="`/datasets/${id}`" class="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950" @click.stop>
                      {{ ds.byUuid[id] ? ds.name(id) : 'A dataset you cannot see' }}
                    </RouterLink>
                    <StatusPill v-if="ds.byUuid[id]" :record="ds.byUuid[id]" class="ml-2"/>
                    <div v-if="ds.byUuid[id]?.tags?.length" class="text-xs font-normal text-slate-500">
                      <span v-for="t in ds.byUuid[id].tags" :key="t">#{{ t }} </span>
                    </div>
                  </td>
                  <td class="px-4 py-2">{{ ds.byUuid[id] ? fmt_window(ds.byUuid[id].from, ds.byUuid[id].to) : '–' }}</td>
                  <td class="px-4 py-2 tabular-nums">{{ duration(ds.byUuid[id]) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <DevicesTable :record="record" :resolved="resolved" :labels="labels"
                      :series="data.series.value" :strips="data.strips.value" :from="data.window.value.from" :to="data.axisTo.value"
                      :loading="data.loading.value" :error="data.error.value" :count-note="data.countNote.value"
                      :gaps="gaps"/>

        <div ref="pinnedEl">
          <PinnedCard :entries="pinned" :series="spark.series.value" :display="spark.display" :from="sparkRange.from" :to="sparkRange.to"
                      :live="spark.live.value" :hint="spark.hint.value" :so-far="soFar" :error="spark.error.value"
                      :range-id="sparkId" @range="id => sparkChoice = id" @tab="t => $emit('tab', t)"/>
        </div>
      </div>

      <!-- Side column. -->
      <div class="flex min-w-0 flex-[1_1_280px] flex-col gap-4">
        <AddonsSummary :ec="ec" @open="$emit('tab', 'add-ons')"/>

        <Card class="flex flex-col gap-1 p-4">
          <div class="mb-1 font-semibold">Use</div>
          <Button variant="ghost" size="sm" class="justify-start" :disabled="downloading" @click="$emit('download')">
            <i :class="['fa-solid fa-fw mr-2', downloading ? 'fa-circle-notch animate-spin' : 'fa-download']"></i>Download CSV
          </Button>
          <Button v-if="grafana" variant="ghost" size="sm" class="justify-start" as-child>
            <a :href="grafana" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square fa-fw mr-2"></i>Open in Grafana</a>
          </Button>
          <Button variant="ghost" size="sm" class="justify-start" @click="$emit('tab', 'use')">
            <i class="fa-solid fa-code fa-fw mr-2"></i>API reference
          </Button>
          <Button variant="ghost" size="sm" class="justify-start" @click="$emit('tab', 'use')">
            <i class="fa-solid fa-user-plus fa-fw mr-2"></i>Share
          </Button>
        </Card>

        <IncludedIn :record="record"/>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useNow, useElementSize } from '@vueuse/core'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { fmt_time, fmt_window, fmt_duration, fmt_elapsed } from '@/lib/datasets/model.js'
import { window_gaps, fmt_coverage, coverage_sub } from '@/lib/datasets/gaps.js'
import { metric_total, group_items } from './page-logic.js'
import StatusPill from '../StatusPill.vue'
import AddonsSummary from '../addons/AddonsSummary.vue'
import RecordingsCard from './RecordingsCard.vue'
import DevicesTable from './DevicesTable.vue'
import PinnedCard from './PinnedCard.vue'
import { useDatasetPins } from './usePins.js'
import { usable_windows, COVERAGE_NOTE } from '@/lib/datasets/series.js'
import { useDatasetSeries } from './useDatasetSeries.js'
import { useChartSeries } from './useChartSeries.js'
import { spark_range, default_spark_range } from '@/lib/datasets/chart-view.js'
import IncludedIn from './IncludedIn.vue'

const props = defineProps({
  record: { type: Object, required: true },
  resolved: { type: Object, required: true },
  labels: { type: Object, default: () => ({}) },
  ec: { type: Object, required: true },
  grafana: { type: String, default: null },
  downloading: { type: Boolean, default: false },
})
defineEmits(['tab', 'download'])

const ds = useDatasetsStore()
const router = useRouter()
const now = useNow({ interval: 1000 })

const recording = computed(() => props.record.kind === 'equipment' && props.record.recording?.startedAt ? props.record.recording : null)
const elapsed = computed(() => recording.value ? fmt_elapsed(now.value.getTime() - Date.parse(recording.value.startedAt)) : '')
const isGroup = computed(() => props.record.kind === 'process' || props.record.kind === 'part')
const items = computed(() => group_items(props.record, ds.byUuid))

const devices = computed(() => props.resolved.devices.map(d => ds.deviceByUuid[d]).filter(Boolean))

// Strips, coverage and quiet since, across the dataset's window. Strips
// are 240 px wide, so about that many buckets.
const STRIP_PX = 240
const { entries: pinned } = useDatasetPins(() => props.record, () => props.resolved)
const data = useDatasetSeries(() => props.record, [], { width: STRIP_PX, count: true, last: true })

// Sparklines: the pinned metrics over the chosen span, ending at now (or
// the window's end), so the line fills its width with the data so far.
// They fill the pinned card less its label and value columns
// (PinnedCard), which sets the bucket size.
const SPARK_CHROME_PX = 220 + 96 + 56
const pinnedEl = ref(null)
const { width: pinnedWidth } = useElementSize(pinnedEl)
const sparkChoice = ref(null)
const sparkId = computed(() => sparkChoice.value ?? default_spark_range(data.window.value, data.now.value))
const spark = useChartSeries(() => props.record, pinned, {
  view: () => spark_range(sparkId.value, data.window.value, data.now.value),
  width: () => pinnedWidth.value ? Math.max(200, pinnedWidth.value - SPARK_CHROME_PX) : 400,
})
const sparkRange = computed(() => spark.range.value)
// The window is still filling in.
const soFar = computed(() => spark.live.value && !data.window.value.windowless)


/* Gaps and coverage across the window, from the strip counts. Devices
 * the service would not show are left out. Time outside a device's
 * windows, or not yet summarised, is neither data nor gap. */
const gaps = computed(() => {
  const s = data.strips.value
  if (!s?.every || data.countNote.value || !props.record.structure) return null
  const from = data.window.value.from, to = data.axisTo.value
  const counts = {}, windows = {}
  for (const d of props.resolved.devices) {
    if (s.denied.includes(d)) continue
    counts[d] = s.devices[d]?.count ?? []
    windows[d] = usable_windows(s.devices[d]?.windows ?? null, s.pending, from, to)
  }
  if (!Object.keys(counts).length) return null
  return window_gaps(counts, { from, to, every: s.every, now: s.asOf, windows })
})

const coverage = computed(() => {
  if (!props.record.structure) return { value: '–', sub: 'Needs edit access to see' }
  if (data.countNote.value === COVERAGE_NOTE) return { value: '–', sub: 'Appears once the coverage summary has been built' }
  if (data.countNote.value) return { value: '–', sub: 'Did not load' }
  if (data.error.value) return { value: '–', sub: 'Did not load' }
  if (!gaps.value) return { value: '–', sub: data.loading.value ? 'Loading' : '' }
  if (gaps.value.coverage == null) return { value: '–', sub: 'The window has not started' }
  const sub = coverage_sub(gaps.value, d => ds.deviceByUuid[d]?.name ?? d.slice(0, 8))
  return { value: fmt_coverage(gaps.value.coverage), sub: sub.text, subCls: sub.cls }
})

function duration (r) {
  return r?.from && r?.to ? fmt_duration(Date.parse(r.to) - Date.parse(r.from)) : '–'
}

const stats = computed(() => {
  const r = props.record
  const out = []
  if (recording.value) out.push({ label: 'Recording for', value: elapsed.value, sub: `Since ${fmt_time(recording.value.startedAt)}` })
  else if (r.from && r.to) out.push({ label: 'Window', value: duration(r), sub: fmt_window(r.from, r.to) })
  else out.push({ label: 'Window', value: 'Ongoing', sub: data.window.value.windowless ? 'No time window. Coverage shows the last 24 hours.' : 'No time window' })
  const known = r.structure != null
  out.push({ label: 'Devices', value: known ? String(props.resolved.devices.length) : '–', sub: known ? (props.resolved.unknown.length ? 'Some parts are hidden from you' : 'Covered by this dataset') : 'Needs edit access to see' })
  out.push({ label: 'Metrics', value: known ? String(metric_total(devices.value)) : '–', sub: 'Recorded to the historian' })
  out.push({ label: 'Coverage', ...coverage.value })
  return out
})
</script>
