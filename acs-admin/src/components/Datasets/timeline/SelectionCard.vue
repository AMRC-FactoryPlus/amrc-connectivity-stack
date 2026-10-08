<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The card beside a timeline selection: the window, how many devices
     and metrics, any gaps in the data (at Hours zoom), and Make
     dataset, which opens the builder pre-filled.
     There is no CSV button: a CSV needs a saved dataset. -->
<template>
  <div data-no-drag role="dialog" aria-label="Selection"
       class="flex w-[300px] cursor-default flex-col rounded-md border border-slate-200 bg-white text-slate-950 shadow-md">
    <div class="flex items-start gap-2 border-b border-slate-100 py-3 pl-3.5 pr-3">
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold leading-5">
          {{ fmt_time(from, now) }} <span class="font-normal text-slate-400">to</span> {{ fmt_time(to, now) }}
        </div>
        <div class="text-xs text-slate-500">
          {{ fmt_duration(to - from) }} · {{ summary.count }} {{ summary.count === 1 ? 'device' : 'devices' }} · {{ metric_count(summary.metrics) }}
        </div>
      </div>
      <Button variant="ghost" size="plain" class="-mr-1 -mt-0.5 h-6 px-1.5" title="Clear selection" @click="emit('close')">
        <i class="fa-solid fa-xmark text-[11px] text-slate-500"></i>
        <span class="sr-only">Clear selection</span>
      </Button>
    </div>
    <div class="flex flex-col gap-1 px-3.5 py-2">
      <div v-for="d in summary.shown" :key="d.uuid"
           class="flex items-center gap-2 overflow-hidden whitespace-nowrap text-[13px] text-slate-700">
        <i class="fa-solid fa-microchip fa-fw text-[11px] text-slate-500"></i>
        <span class="truncate" :title="d.name">{{ d.name }}</span>
      </div>
      <div v-if="summary.more" class="pl-6 text-xs text-slate-500">and {{ summary.more }} more</div>
      <div v-if="gapLine" class="mt-0.5 flex items-center gap-1.5 text-xs" :class="gapLine.cls">
        <span class="size-1.5 shrink-0 rounded-full" :class="gapLine.dot"></span>{{ gapLine.text }}
      </div>
      <div v-if="to > now" class="mt-0.5 text-xs text-slate-500">
        <i class="fa-solid fa-clock text-[10px]"></i> Ends in the future. It fills in as data arrives.
      </div>
    </div>
    <div class="flex gap-1.5 rounded-b-md border-t border-slate-200 bg-slate-50 px-3 py-2.5">
      <Button size="sm" class="flex-1" :disabled="!summary.count" @click="emit('make')">
        <i class="fa-solid fa-plus mr-1.5"></i>Make dataset
      </Button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { fmt_time, fmt_duration } from '@/lib/datasets/model.js'
import { metric_count } from '@/lib/datasets/timeline.js'
import { selection_gap_line } from '@/lib/datasets/gaps.js'

const props = defineProps({
  from: { type: Number, required: true },
  to: { type: Number, required: true },
  // selection_summary() result.
  summary: { type: Object, required: true },
  now: { type: Number, required: true },
  // Gaps in the window, or null when not known (zooms other than Hours).
  gaps: { type: Number, default: null },
})
const gapLine = computed(() => props.gaps == null ? null : selection_gap_line(props.gaps))
const emit = defineEmits(['close', 'make'])
</script>
