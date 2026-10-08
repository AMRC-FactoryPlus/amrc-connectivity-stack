<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Pinned metrics on the Overview: a sparkline and the newest value
     for each, over a span chosen here. The data comes from the same
     useChartSeries as the Data tab charts, so it goes live in the same
     way. -->
<template>
  <Card class="flex flex-col overflow-hidden">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
      <span class="font-semibold">Pinned metrics <span class="font-normal text-slate-500">{{ entries.length }}</span></span>
      <div class="flex flex-wrap items-center gap-3">
        <span v-if="live && entries.length" class="inline-flex items-center gap-1 text-xs text-green-700">
          <span class="size-1.5 rounded-full bg-green-500"></span>Live
          <span v-if="hint" class="text-slate-400">{{ hint }}</span>
        </span>
        <!-- The span every sparkline shows. -->
        <div v-if="entries.length" class="inline-flex rounded-md border border-slate-200 p-0.5" role="radiogroup" aria-label="Sparkline span">
          <button v-for="r in SPARK_RANGES" :key="r.id" type="button" role="radio" :aria-checked="r.id === rangeId"
                  class="rounded px-2 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
                  :class="r.id === rangeId ? 'bg-slate-900 text-slate-50' : 'text-slate-600 hover:bg-slate-100'"
                  @click="$emit('range', r.id)">{{ r.label }}</button>
        </div>
      </div>
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
        <div class="w-[220px] min-w-0 shrink-0">
          <div class="truncate text-[13px] font-semibold" :title="e.path">{{ e.label }}</div>
          <div class="truncate text-xs text-slate-500">{{ e.deviceName }}</div>
        </div>
        <!-- Drawn in a W by H box and stretched to fill the row. -->
        <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="min-w-[240px] flex-1" :style="{ height: `${H}px` }" aria-hidden="true">
          <title>{{ e.path }}</title>
          <path v-if="e.path_d" :d="e.path_d" fill="none" stroke="#0f172a" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
          <line v-else-if="series" x1="0" :y1="H / 2" :x2="W" :y2="H / 2" stroke="#e2e8f0" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>
        </svg>
        <div class="w-24 shrink-0 text-right text-[13px] tabular-nums">
          <template v-if="e.latest != null">
            {{ e.latest }}<span v-if="e.unit" class="ml-1 text-xs text-slate-500">{{ e.unit }}</span>
            <div v-if="soFar" class="text-[11px] text-slate-400">so far</div>
          </template>
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
import { sparkline_path, latest_point } from '@/lib/datasets/series.js'
import { SPARK_RANGES } from '@/lib/datasets/chart-view.js'

const props = defineProps({
  // pinned_entries()
  entries: { type: Array, required: true },
  // From useChartSeries: the series, and display(key) for what to draw.
  series: { type: Object, default: null },
  display: { type: Function, default: null },
  // How often the line moves, at coarse buckets.
  hint: { type: String, default: null },
  // The chosen span (SPARK_RANGES id).
  rangeId: { type: String, default: '24h' },
  from: { type: Number, required: true },
  to: { type: Number, required: true },
  live: { type: Boolean, default: false },
  // The window is still filling in: the sparklines end at now.
  soFar: { type: Boolean, default: false },
  error: { type: String, default: null },
})
defineEmits(['tab', 'range'])

// The drawing box; the SVG stretches it to the row's width.
const W = 1000
const H = 28
const MAX = 8

const num = v => Math.abs(v) >= 1000 ? v.toFixed(0) : String(+v.toPrecision(4))

const shown = computed(() => props.entries.slice(0, MAX).map(e => {
  const m = props.series?.metrics[e.key]
  const d = props.series && props.display ? props.display(e.key) : { rows: [], step: false }
  const last = latest_point(m)
  return {
    ...e,
    unit: m?.unit ?? e.unit,
    path_d: d.rows.length ? sparkline_path(d.rows, { from: props.from, to: props.to, w: W, h: H, step: d.step }) : '',
    latest: last ? num(last[1]) : null,
  }
}))
</script>
