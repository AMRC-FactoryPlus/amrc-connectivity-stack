<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- One device lane: the device's name, its Sparkplug status and its
     equipment label or metric count, and an empty track you drag
     across to select. The timeline handles the drag for all lanes. -->
<template>
  <div class="absolute left-0 flex border-b border-slate-200"
       :style="{ top: `${row.top}px`, height: `${row.h}px`, width: `${LABEL_W + trackWidth}px` }">
    <div class="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-slate-200 bg-white pl-10 pr-3 text-[13px] text-slate-700"
         :style="{ width: `${LABEL_W}px` }">
      <i class="fa-solid fa-microchip fa-fw shrink-0 text-[11px] text-slate-500"></i>
      <span class="min-w-0 flex-1 truncate" :title="row.name">{{ row.name }}</span>
      <span v-if="status" class="size-2 shrink-0 rounded-full" :class="status.dot" :title="status.text">
        <span class="sr-only">{{ status.text }}</span>
      </span>
      <span class="shrink-0 whitespace-nowrap text-[11px] text-gray-500">{{ row.tag }}</span>
    </div>
    <div class="relative shrink-0 cursor-crosshair" :style="{ width: `${trackWidth}px` }">
      <!--
        Data-arrival strip goes here. There is no endpoint for it yet
        (build decision D2), so nothing fills it. When one exists, pass
        cells through `strip` or fill the `strip` slot.
      -->
      <slot name="strip" :strip="strip" :row="row"/>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { fmt_time } from '@/lib/datasets/model.js'
import { LABEL_W } from '@/lib/datasets/timeline.js'

const props = defineProps({
  row: { type: Object, required: true },
  trackWidth: { type: Number, required: true },
  // Reserved for data-arrival cells, [{ x, w, density }]. Always null
  // until a coverage endpoint exists.
  strip: { type: Array, default: null },
})

// Online or offline from the Directory. This is the device's Sparkplug
// session, not whether data is arriving.
const status = computed(() => {
  const s = props.row.status
  if (!s) return null
  if (s.online) return { dot: 'bg-green-500', text: 'Live' }
  return {
    dot: 'bg-slate-400',
    text: s.last_change ? `Offline since ${fmt_time(s.last_change)}` : 'Offline',
  }
})
</script>
