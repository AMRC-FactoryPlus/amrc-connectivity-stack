<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- One lane that is not a device: a group header (ongoing, other
     devices), a site and area heading, an ongoing dataset band, or a
     piece of equipment with its recording blocks (and, when collapsed,
     a 3px strip of when its devices sent data). The timeline places
     it with `top`; the label cell stays pinned on the left. -->
<template>
  <div class="absolute left-0 flex border-b border-slate-200"
       :style="{ top: `${row.top}px`, height: `${row.h}px`, width: `${LABEL_W + trackWidth}px` }">
    <!-- Label -->
    <div class="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-slate-200 pr-3"
         :class="labelClass" :style="{ width: `${LABEL_W}px` }">
      <button v-if="toggles" type="button"
              class="flex size-5 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-200"
              :title="row.open ? 'Hide' : 'Show'" :aria-expanded="row.open" @click="emit('toggle', row)">
        <i class="fa-solid text-[10px]" :class="row.open ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
      </button>
      <i class="fa-solid fa-fw shrink-0 text-[11px] text-slate-500" :class="`fa-${icon}`"></i>
      <RouterLink v-if="row.uuid" :to="`/datasets/${row.uuid}`" :title="row.name"
                  class="min-w-0 flex-1 truncate hover:underline">{{ row.name }}</RouterLink>
      <span v-else class="min-w-0 flex-1 truncate" :title="row.name">{{ row.name }}</span>
      <span v-if="row.tag" class="shrink-0 whitespace-nowrap text-[11px] font-normal text-gray-500">{{ row.tag }}</span>
    </div>

    <!-- Track -->
    <div class="relative shrink-0" :class="trackClass" :style="{ width: `${trackWidth}px` }">
      <RouterLink v-if="row.kind === 'band'" :to="`/datasets/${row.uuid}`" :title="row.name"
                  class="absolute inset-x-0 top-[5px] z-[3] flex h-[26px] items-center rounded border border-slate-200 text-xs text-slate-600 hover:border-slate-400"
                  :style="{ background: HATCH }">
        <span class="sticky left-[268px] truncate px-2">{{ row.label }}</span>
      </RouterLink>

      <template v-if="row.kind === 'equipment'">
        <component :is="b.uuid ? RouterLink : 'div'" v-for="b in blocks" :key="b.key"
                   :to="b.uuid ? `/datasets/${b.uuid}` : undefined"
                   :title="`${b.name} · ${fmt_window(b.from, b.style === 'recording' ? null : b.to)}${b.sub ? ` · ${b.sub}` : ''}`"
                   class="absolute top-[5px] z-[3] flex h-[26px] flex-col justify-center overflow-hidden rounded text-[11px] leading-3 transition-colors"
                   :class="BLOCK_CLASS[b.style]"
                   :style="{ left: `${b.left}px`, width: `${b.w}px`, paddingLeft: `${b.inset}px`, paddingRight: '6px' }">
          <span v-if="b.show_title" class="truncate font-semibold">{{ b.title }}</span>
          <span v-if="b.show_sub && b.sub" class="truncate opacity-80">{{ b.sub }}</span>
        </component>
        <!-- Collapsed: a thin strip of when its devices sent data. -->
        <template v-if="!row.open && strip">
          <span v-for="c in strip" :key="c.x" class="pointer-events-none absolute bottom-0 h-[3px]"
                :style="{ left: `${c.x}px`, width: `${c.w}px`, background: c.colour }"></span>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { fmt_window } from '@/lib/datasets/model.js'
import { LABEL_W } from '@/lib/datasets/timeline.js'

const props = defineProps({
  row: { type: Object, required: true },
  trackWidth: { type: Number, required: true },
  // Placed blocks (place_blocks) for an equipment lane.
  blocks: { type: Array, default: () => [] },
  // Data-arrival cells for a collapsed equipment row, or null.
  strip: { type: Array, default: null },
})
const emit = defineEmits(['toggle'])

const HATCH = 'repeating-linear-gradient(135deg, #f8fafc 0 6px, #f1f5f9 6px 12px)'

// Recording block styles, from the design.
const BLOCK_CLASS = {
  done:      'border border-slate-300 bg-slate-100 text-slate-900 hover:border-slate-500',
  recording: 'border border-green-600 bg-green-50 text-green-800',
  reference: 'border border-dashed border-slate-500 bg-white text-slate-900 hover:bg-slate-50',
  voided:    'border border-dashed border-slate-300 bg-transparent text-slate-400 hover:border-slate-400',
}

const toggles = computed(() => ['ongoing-header', 'other-header', 'equipment'].includes(props.row.kind))

const icon = computed(() => ({
  'ongoing-header': 'thumbtack',
  'other-header':   'microchip',
  'equipment':      'industry',
  'band':           'database',
  'place':          'location-dot',
}[props.row.kind] ?? 'database'))

const labelClass = computed(() => ({
  'ongoing-header': 'bg-slate-50 pl-2 text-xs font-semibold text-slate-600',
  'other-header':   'bg-slate-50 pl-2 text-[13px] font-semibold text-slate-600',
  'equipment':      'bg-white pl-2 text-sm font-semibold text-slate-950',
  'band':           'bg-white pl-6 text-[13px] font-medium text-slate-950',
  'place':          'bg-white pl-8 text-xs text-slate-500',
}[props.row.kind]))

const trackClass = computed(() => props.row.kind.endsWith('-header') ? 'bg-slate-50' : '')
</script>
