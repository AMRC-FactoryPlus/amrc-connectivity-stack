<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The devices a dataset covers: name with a status dot, site and
     area, the equipment label, the number of historised metrics, the
     data rate, and a strip of when data arrived across the dataset's
     window with a note on any gaps. -->
<template>
  <Card class="overflow-hidden">
    <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
      <span class="font-semibold">Devices <span class="font-normal text-slate-500">{{ rows.length }}</span></span>
    </div>
    <div v-if="!record.structure" class="px-4 py-6 text-center text-sm text-slate-500">
      Structure is visible to people who can edit this dataset.
    </div>
    <div v-else-if="!rows.length" class="px-4 py-6 text-center text-sm text-slate-500">
      This dataset covers no devices.
    </div>
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th class="px-4 py-2 font-medium">Device</th>
            <th class="px-4 py-2 font-medium">Label</th>
            <th class="px-4 py-2 text-right font-medium">Metrics</th>
            <th class="px-4 py-2 font-medium" title="Points the device sent across all its metrics, per second or minute, while it was sending">Data rate</th>
            <th class="px-4 py-2 font-medium">Data across the window</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.dd" class="border-t border-slate-100">
            <td class="max-w-72 px-4 py-2.5">
              <div class="flex items-center gap-2 font-medium" :title="row.name">
                <i class="fa-solid fa-microchip fa-fw text-xs text-slate-500"></i>
                <span class="truncate">{{ row.name }}</span>
                <span :class="['size-1.5 shrink-0 rounded-full', row.status.dot]" :title="row.status.label">
                  <span class="sr-only">{{ row.status.label }}</span>
                </span>
              </div>
              <div v-if="row.where" class="pl-6 text-xs text-slate-500">{{ row.where }}</div>
            </td>
            <td class="px-4 py-2.5">
              <span v-if="row.label" class="rounded border border-slate-200 px-1.5 py-0.5 text-xs font-medium">{{ row.label }}</span>
            </td>
            <td class="px-4 py-2.5 text-right tabular-nums text-slate-700">{{ row.metrics ?? '–' }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-700">{{ row.rate || '–' }}</td>
            <td class="px-4 py-2.5">
              <div class="relative h-2.5 rounded-sm bg-slate-50" :style="{ width: `${STRIP_W}px` }">
                <span v-for="c in row.strip.cells" :key="c.x" class="absolute inset-y-0"
                      :style="{ left: `${c.x}px`, width: `${c.w}px`, background: c.colour }"></span>
              </div>
              <div v-if="row.note.text" class="mt-0.5 text-xs" :class="row.note.cls">{{ row.note.text }}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="record.structure && countNote" class="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
      <i class="fa-solid fa-circle-info mr-1"></i>{{ countNote }}
    </div>
    <div v-if="record.structure && error" class="border-t border-slate-200 px-4 py-2 text-xs text-red-700">
      <i class="fa-solid fa-triangle-exclamation mr-1"></i>{{ error }}
    </div>
    <div v-if="record.structure && unknown.length" class="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
      <i class="fa-solid fa-eye-slash mr-1"></i>
      {{ unknown.length }} {{ unknown.length === 1 ? 'part of this dataset is' : 'parts of this dataset are' }} not visible to you, so their devices are not listed.
    </div>
  </Card>
</template>

<script setup>
import { computed } from 'vue'
import { useNow } from '@vueuse/core'
import { Card } from '@/components/ui/card'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { device_status, window_strip } from '@/lib/datasets/series.js'
import { gap_note, data_rate, fmt_rate } from '@/lib/datasets/gaps.js'

const props = defineProps({
  record: { type: Object, required: true },
  resolved: { type: Object, required: true },
  labels: { type: Object, default: () => ({}) },
  // From useDatasetSeries: `series` for last, `strips` for counts.
  series: { type: Object, default: null },
  strips: { type: Object, default: null },
  from: { type: Number, default: null },
  to: { type: Number, default: null },
  loading: { type: Boolean, default: false },
  error: { type: String, default: null },
  countNote: { type: String, default: null },
  // window_gaps() over the window, or null.
  gaps: { type: Object, default: null },
})

const STRIP_W = 240
const NO_STRIP = { cells: [], gaps: 0, any: false }

const ds = useDatasetsStore()
const now = useNow({ interval: 30 * 1000 })
const unknown = computed(() => props.resolved.unknown.filter(u => u !== props.record.uuid || props.record.structure))

function note (g) {
  if (props.error || props.countNote) return { text: '', cls: '' }
  if (!props.strips) return { text: props.loading ? 'Loading' : '', cls: 'text-slate-400' }
  if (!g?.grid.length) return { text: '', cls: '' }
  if (!g.points) return { text: 'No data in this window', cls: 'text-amber-700' }
  if (g.gaps.length) return { text: gap_note(g.gaps), cls: 'text-amber-700' }
  return { text: 'Complete', cls: 'text-slate-500' }
}

const rows = computed(() => props.resolved.device_datasets.map(dd => {
  const dev_uuid = ds.byUuid[dd]?.config?.source
  const dev = ds.deviceByUuid[dev_uuid]
  const data = props.series?.devices[dev_uuid]
  const counts = props.strips?.devices[dev_uuid]?.count
  const strip = props.strips && props.from != null && props.to != null
    ? window_strip(counts ?? [], { from: props.from, to: props.to, width: STRIP_W, cell: 4 })
    : NO_STRIP
  const g = props.gaps?.devices[dev_uuid] ?? null
  return {
    dd,
    name: dev?.name ?? ds.name(dd),
    where: [dev?.site, dev?.area].filter(Boolean).join(' · '),
    label: props.labels[dd] ?? null,
    metrics: dev?.metrics?.length ?? null,
    status: device_status(dev?.status ?? null, data?.last, now.value.getTime()),
    rate: g && props.strips?.every ? fmt_rate(data_rate(g, props.strips.every)) : '',
    strip,
    note: note(g),
  }
}))
</script>
