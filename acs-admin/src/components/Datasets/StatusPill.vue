<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The status of a dataset: recording (with a live timer), voided,
     invalid, or a window that ends in the future. Shows nothing
     otherwise. `pill` gives the uppercase header form. -->
<template>
  <span v-if="status === 'recording'"
        :class="pill ? 'rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide bg-green-50 text-green-700 border border-green-600' : 'text-sm text-green-700'"
        class="inline-flex items-center gap-1.5 whitespace-nowrap">
    <span class="size-2 rounded-full bg-green-500 animate-pulse"></span>
    <span>{{ pill ? 'Recording now' : `Recording ${elapsed}` }}</span>
  </span>
  <span v-else-if="status === 'voided'"
        :class="pill ? 'rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide bg-slate-100 text-slate-600' : 'text-sm text-slate-500'"
        class="inline-flex items-center gap-1.5 whitespace-nowrap">
    <i class="fa-solid fa-ban"></i><span>Voided</span>
  </span>
  <span v-else-if="status === 'invalid'"
        :class="pill ? 'rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide bg-red-50 text-red-600 border border-red-300' : 'text-sm text-red-600'"
        class="inline-flex items-center gap-1.5 whitespace-nowrap">
    <i class="fa-solid fa-triangle-exclamation"></i><span>Invalid</span>
  </span>
  <span v-else-if="status === 'filling'"
        :class="pill ? 'rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide bg-slate-100 text-slate-700' : 'text-sm text-slate-600'"
        class="inline-flex items-center gap-1.5 whitespace-nowrap">
    <i class="fa-solid fa-hourglass-half"></i><span>Filling in</span>
  </span>
</template>

<script setup>
import { computed } from 'vue'
import { useNow } from '@vueuse/core'
import { dataset_status, fmt_elapsed } from '@/lib/datasets/model.js'

const props = defineProps({
  record: { type: Object, required: true },
  pill: { type: Boolean, default: false },
})

const now = useNow({ interval: 1000 })
const status = computed(() => dataset_status(props.record, now.value.getTime()))
const elapsed = computed(() => {
  const s = props.record.recording?.startedAt
  return s ? fmt_elapsed(now.value.getTime() - Date.parse(s)) : ''
})
</script>
