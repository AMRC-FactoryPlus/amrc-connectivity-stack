<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The rows of the device picker's ISA-95 tree, from nest_rows. Each
     level wraps its own rows, so its header sticks below its parents'
     headers only while those rows are in view: the stack of headers at
     the top always shows where the rows below sit. `ctx` carries the
     picker's state and handlers. -->
<template>
  <template v-for="it in items" :key="it.row.node ? 'n' + it.row.node.key : 'd' + it.row.device.uuid">
    <!-- An ISA-95 level and everything under it -->
    <div v-if="it.row.node">
      <div class="sticky flex items-center gap-2 border-b border-slate-100 bg-white pr-4 hover:bg-slate-50"
           :style="{ top: it.row.depth * ctx.ROW_PX + 'px', height: ctx.ROW_PX + 'px', zIndex: 20 - it.row.depth, paddingLeft: ctx.indent(it.row.depth) }">
        <button type="button" class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-200"
                :aria-label="(it.row.open ? 'Collapse ' : 'Expand ') + it.row.node.name" :aria-expanded="it.row.open" @click="ctx.toggleOpen(it.row)">
          <i class="fa-solid fa-chevron-right text-[10px] transition-transform duration-75" :class="it.row.open && 'rotate-90'"></i>
        </button>
        <TreeCheck :state="ctx.levelState(it.row)" :label="'Select every device in ' + it.row.node.name" @toggle="ctx.toggleLevel(it.row)"/>
        <button type="button" class="flex h-10 min-w-0 flex-1 items-center gap-2 text-left" @click="ctx.toggleOpen(it.row)">
          <i class="fa-solid fa-fw fa-sitemap text-xs text-slate-500"></i>
          <span class="truncate text-sm" :class="it.row.depth ? 'font-medium' : 'font-semibold'" :title="it.row.node.name">{{ it.row.node.name }}</span>
          <span class="ml-auto shrink-0 rounded bg-gray-100 px-1.5 py-px text-xs text-slate-600">{{ ctx.levelName(it.row) }}</span>
          <span class="shrink-0 text-xs text-slate-600">{{ ctx.countOf(it.row) }}</span>
        </button>
      </div>
      <PickerTree :items="it.children" :ctx="ctx"/>
    </div>
    <!-- A device -->
    <div v-else class="flex h-12 items-center gap-2 pr-4" :class="ctx.isAdded(it.row.device.uuid) ? 'opacity-50' : 'hover:bg-slate-100'"
         :style="{ paddingLeft: ctx.indent(it.row.depth) }">
      <span class="w-6 shrink-0" aria-hidden="true"></span>
      <TreeCheck :state="ctx.isAdded(it.row.device.uuid) || ctx.isChosen(it.row.device.uuid) ? 'all' : 'none'"
                 :disabled="ctx.isAdded(it.row.device.uuid)" :label="'Select ' + it.row.device.name" @toggle="ctx.toggle(it.row.device.uuid)"/>
      <button type="button" class="flex h-12 min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
              :disabled="ctx.isAdded(it.row.device.uuid)" @click="ctx.toggle(it.row.device.uuid)">
        <i class="fa-solid fa-fw fa-microchip text-xs text-slate-500"></i>
        <span class="min-w-0">
          <span class="block truncate text-sm" :title="it.row.device.name">{{ it.row.device.name }}</span>
          <span class="block truncate text-xs text-slate-500">{{ ctx.subOf(it.row.device) }}</span>
        </span>
        <span v-if="ctx.isAdded(it.row.device.uuid)" class="ml-auto shrink-0 text-xs text-slate-500">Added</span>
        <span v-else class="ml-auto flex shrink-0 items-center gap-1.5 text-xs" :class="ctx.statusOf(it.row.device).text">
          <span class="h-1.5 w-1.5 rounded-full" :class="ctx.statusOf(it.row.device).dot"></span>{{ ctx.statusOf(it.row.device).label }}
        </span>
      </button>
    </div>
  </template>
</template>

<script setup>
import TreeCheck from './TreeCheck.vue'

defineProps({
  items: { type: Array, required: true },
  ctx: { type: Object, required: true },
})
</script>
