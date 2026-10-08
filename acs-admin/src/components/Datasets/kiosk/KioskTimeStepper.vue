<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- A time in London with touch-sized steppers (±1 h, ±5 min, ±1 min).
     The time never moves past `now`. -->
<template>
  <div class="flex flex-col gap-2">
    <span class="text-sm font-medium text-slate-700">{{ label }}<template v-if="showDay"> · {{ fmt_day(modelValue) }}</template></span>
    <div class="text-4xl font-semibold tabular-nums leading-10">{{ fmt_clock(modelValue) }}</div>
    <div class="grid gap-1.5" :class="compact ? 'grid-cols-3' : 'grid-cols-6'">
      <button v-for="s in STEPS" :key="s.delta" type="button"
              class="h-12 rounded-md bg-white text-sm font-medium ring-1 ring-slate-200 transition-colors hover:bg-slate-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
              :disabled="s.delta > 0 && modelValue >= now"
              :aria-label="`${label} ${s.label}`"
              @click="emit('update:modelValue', step_time(modelValue, s.delta, now))">
        {{ s.label }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { fmt_clock, fmt_day } from '@/lib/datasets/model.js'
import { STEPS, step_time } from '@/lib/datasets/kiosk.js'

defineProps({
  label: { type: String, required: true },
  modelValue: { type: Number, required: true },
  now: { type: Number, required: true },
  showDay: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])
</script>
