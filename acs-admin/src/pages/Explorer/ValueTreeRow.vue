<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { computed } from 'vue'
import QualityBadge from '@components/QualityBadge.vue'
import dayjs from 'dayjs'

const props = defineProps({
  node: { type: Object, required: true },
  depth: { type: Number, default: 0 },
  collapsed: { type: Set, required: true },
  loadingIds: { type: Set, required: true },
})

const emit = defineEmits(['toggle'])

// A composition is open unless the user closed it. One whose children
// have not been read yet shows closed until it is expanded.
const isOpen = computed(() =>
  props.node.children !== null && !props.collapsed.has(props.node.elementId))
const isLoading = computed(() => props.loadingIds.has(props.node.elementId))

function formatTimestamp (ts) {
  if (!ts) return '-'
  return dayjs(ts).format('YYYY-MM-DD HH:mm:ss')
}

function formatValue (val) {
  if (val === null || val === undefined) return '-'
  if (typeof val === 'object') return JSON.stringify(val, null, 2)
  return String(val)
}
</script>

<template>
  <tr
    class="border-t"
    :class="{ 'bg-slate-50/60 cursor-pointer hover:bg-slate-100': node.isComposition }"
    @click="node.isComposition && emit('toggle', node)"
  >
    <td class="px-3 py-1.5" :title="node.elementId">
      <div class="flex items-center gap-1.5" :style="{ paddingLeft: `${depth * 16}px` }">
        <template v-if="node.isComposition">
          <i
            class="fa-solid fa-chevron-right text-[10px] text-slate-400 w-3 transition-transform duration-200"
            :class="{ 'rotate-90': isOpen }"
          ></i>
          <i class="fa-solid fa-folder text-[10px] text-amber-500"></i>
          <span class="font-medium">{{ node.displayName }}</span>
          <i v-if="isLoading" class="fa-solid fa-spinner fa-spin text-[10px] text-slate-400"></i>
        </template>
        <template v-else>
          <span class="w-3"></span>
          <span>{{ node.displayName }}</span>
        </template>
      </div>
    </td>
    <template v-if="node.isComposition">
      <td colspan="3" class="px-3 py-1.5 text-xs text-slate-400">
        <span v-if="node.children === null">Expand to load</span>
        <span v-else-if="node.children.length === 0">Empty</span>
      </td>
    </template>
    <template v-else>
      <td class="px-3 py-1.5 font-mono whitespace-pre-wrap break-words">{{ formatValue(node.vqt?.value) }}</td>
      <td class="px-3 py-1.5">
        <QualityBadge v-if="node.vqt" :quality="node.vqt.quality" />
        <span v-else class="text-xs text-slate-400">No value</span>
      </td>
      <td class="px-3 py-1.5 text-xs text-slate-400 whitespace-nowrap">{{ formatTimestamp(node.vqt?.timestamp) }}</td>
    </template>
  </tr>
  <template v-if="node.isComposition && isOpen">
    <ValueTreeRow
      v-for="child in node.children"
      :key="child.elementId"
      :node="child"
      :depth="depth + 1"
      :collapsed="collapsed"
      :loading-ids="loadingIds"
      @toggle="n => emit('toggle', n)"
    />
  </template>
</template>
