<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- One device lane: the device's name, its status and its equipment
     label or metric count, and a track you drag across to select. The
     timeline handles the drag for all lanes. The track shows when data
     arrived, and a quiet device gets an amber note from
     the time its data stopped. -->
<template>
  <div class="absolute left-0 flex border-b border-slate-200"
       :style="{ top: `${row.top}px`, height: `${row.h}px`, width: `${LABEL_W + trackWidth}px` }">
    <div class="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-slate-200 bg-white pl-10 pr-3 text-[13px] text-slate-700"
         :style="{ width: `${LABEL_W}px` }">
      <i class="fa-solid fa-microchip fa-fw shrink-0 text-[11px] text-slate-500"></i>
      <span class="min-w-0 flex-1 truncate" :title="row.name">{{ row.name }}</span>
      <span v-if="status" class="size-2 shrink-0 rounded-full" :class="status.dot" :title="status.label">
        <span class="sr-only">{{ status.label }}</span>
      </span>
      <span class="shrink-0 whitespace-nowrap text-[11px] text-slate-500">{{ row.tag }}</span>
    </div>
    <div class="relative shrink-0 cursor-crosshair" :style="{ width: `${trackWidth}px` }">
      <slot name="strip" :strip="strip" :row="row">
        <template v-if="strip">
          <span v-for="c in strip" :key="c.x" class="pointer-events-none absolute top-[13px] h-2.5"
                :style="{ left: `${c.x}px`, width: `${c.w}px`, background: c.colour }"></span>
        </template>
      </slot>
      <span v-if="quiet" class="pointer-events-none absolute top-[10px] z-[3] whitespace-nowrap bg-white/80 px-1 text-xs leading-4 text-amber-700"
            :style="{ left: `${quiet.x + 4}px` }">{{ quiet.text }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { LABEL_W } from '@/lib/datasets/timeline.js'
import { device_status } from '@/lib/datasets/series.js'

const props = defineProps({
  row: { type: Object, required: true },
  trackWidth: { type: Number, required: true },
  // Data-arrival cells, [{ x, w, colour }], or null when strips are off.
  strip: { type: Array, default: null },
  // Newest data time: ms, null for none in 30 days, undefined if not known.
  last: { type: Number, default: undefined },
  // { x, text } for the amber note, placed by the timeline.
  quiet: { type: Object, default: null },
  now: { type: Number, default: () => Date.now() },
})

// Live, quiet or offline: the Directory's Sparkplug session plus
// whether data is still arriving.
const status = computed(() => props.row.status || props.last !== undefined
  ? device_status(props.row.status, props.last, props.now)
  : null)
</script>
