<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Today's lane, 06:00 to 18:00 London time: the equipment's runs,
     the live recording and a line at now. There is no data strip,
     because no endpoint reports when data last arrived. -->
<template>
  <div>
    <div class="relative mb-1 h-4 text-xs text-slate-500">
      <span v-for="t in ticks" :key="t.label" class="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
            :style="{ left: `${t.left}%` }">{{ t.label }}</span>
    </div>
    <div class="relative h-14 rounded-md border border-slate-200 bg-white" role="img" :aria-label="summary">
      <span v-for="t in ticks.slice(1, -1)" :key="t.label" class="absolute inset-y-0 w-px bg-slate-100" :style="{ left: `${t.left}%` }"></span>
      <div v-for="b in blocks" :key="b.key"
           class="absolute top-2 flex h-10 items-center overflow-hidden whitespace-nowrap rounded px-2 text-xs font-semibold"
           :class="STYLE[b.kind]" :style="{ left: `${b.left}%`, width: `${b.width}%` }">
        {{ b.label }}
      </div>
      <div v-if="nowLeft != null" class="absolute -bottom-1 -top-1 w-0.5 bg-slate-900" :style="{ left: `${nowLeft}%` }"></div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { lane_range, lane_ticks, lane_blocks } from '@/lib/datasets/kiosk.js'

const props = defineProps({
  runs: { type: Array, default: () => [] },
  recording: { type: Object, default: null },
  savedRun: { type: String, default: null },
  now: { type: Number, required: true },
})

const STYLE = {
  done:   'border border-slate-300 bg-slate-100 text-slate-900',
  saved:  'border-2 border-slate-900 bg-slate-200 text-slate-900',
  ref:    'border border-dashed border-slate-500 bg-white text-slate-700',
  voided: 'border border-dashed border-slate-300 text-slate-400',
  live:   'border border-green-600 bg-green-50 text-green-800',
}

const range = computed(() => lane_range(props.now))
const ticks = computed(() => lane_ticks(range.value))
const blocks = computed(() => lane_blocks({
  runs: props.runs, recording: props.recording, savedRun: props.savedRun, range: range.value, now: props.now,
}))
const nowLeft = computed(() => {
  const r = range.value
  if (props.now < r.from || props.now > r.to) return null
  return (props.now - r.from) / (r.to - r.from) * 100
})
const summary = computed(() => {
  const n = blocks.value.filter(b => b.kind !== 'live').length
  return `Today: ${n} ${n === 1 ? 'recording' : 'recordings'}${props.recording ? ', one in progress' : ''}`
})
</script>
