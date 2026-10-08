<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Pinned metrics on the Overview: a sparkline and the newest value
     for each. The data comes from the same useDatasetSeries as the Data
     tab charts, so it goes live in the same way. -->
<template>
  <Card class="flex flex-col overflow-hidden">
    <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
      <span class="font-semibold">Pinned metrics <span class="font-normal text-slate-500">{{ entries.length }}</span></span>
      <span v-if="live && entries.length" class="inline-flex items-center gap-1 text-xs text-green-700">
        <span class="size-1.5 rounded-full bg-green-500"></span>Live
      </span>
    </div>
    <div v-if="!entries.length" class="flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-sm text-slate-500">
      Pin metrics on the Data tab to see them here.
      <Button size="sm" variant="outline" @click="$emit('tab', 'data')">
        <i class="fa-solid fa-thumbtack mr-2"></i>Choose metrics
      </Button>
    </div>
    <div v-else-if="error" class="px-4 py-3 text-sm text-red-700">
      <i class="fa-solid fa-triangle-exclamation mr-2"></i>{{ error }}
    </div>
    <template v-else>
      <div v-for="e in shown" :key="e.key" class="flex items-center gap-3 border-b border-slate-100 px-4 py-2 last:border-b-0">
        <div class="min-w-0 flex-1">
          <div class="truncate text-[13px] font-semibold" :title="e.path">{{ e.label }}</div>
          <div class="truncate text-xs text-slate-500">{{ e.deviceName }}</div>
        </div>
        <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" class="shrink-0" aria-hidden="true">
          <path v-if="e.path_d" :d="e.path_d" fill="none" stroke="#0f172a" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round"/>
          <line v-else-if="series" x1="0" :y1="H / 2" :x2="W" :y2="H / 2" stroke="#e2e8f0" stroke-dasharray="3 3"/>
        </svg>
        <div class="w-24 shrink-0 text-right text-[13px] tabular-nums">
          <template v-if="e.latest != null">{{ e.latest }}<span v-if="e.unit" class="ml-1 text-xs text-slate-500">{{ e.unit }}</span></template>
          <span v-else-if="series" class="text-xs text-slate-400">No data</span>
          <i v-else class="fa-solid fa-circle-notch animate-spin text-xs text-slate-400"></i>
        </div>
      </div>
      <button v-if="entries.length > shown.length" type="button" class="px-4 py-2 text-left text-xs text-slate-500 hover:text-slate-900"
              @click="$emit('tab', 'data')">
        {{ entries.length - shown.length }} more on the Data tab
      </button>
    </template>
  </Card>
</template>

<script setup>
import { computed } from 'vue'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { sparkline_path } from '@/lib/datasets/series.js'

const props = defineProps({
  // pinned_entries()
  entries: { type: Array, required: true },
  // From useDatasetSeries.
  series: { type: Object, default: null },
  from: { type: Number, required: true },
  to: { type: Number, required: true },
  live: { type: Boolean, default: false },
  error: { type: String, default: null },
})
defineEmits(['tab'])

const W = 160
const H = 28
const MAX = 8

const num = v => Math.abs(v) >= 1000 ? v.toFixed(0) : String(+v.toPrecision(4))

const shown = computed(() => props.entries.slice(0, MAX).map(e => {
  const m = props.series?.metrics[e.key]
  const pts = m?.points ?? []
  const last = pts.at(-1)
  return {
    ...e,
    unit: m?.unit ?? e.unit,
    path_d: props.series ? sparkline_path(pts, { from: props.from, to: props.to, w: W, h: H, every: props.series.every }) : '',
    latest: last ? num(last[1]) : null,
  }
}))
</script>
