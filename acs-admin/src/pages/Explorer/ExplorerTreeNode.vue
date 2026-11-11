<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { computed } from 'vue'
import { useExplorerStore } from '@store/useExplorerStore.js'

const props = defineProps({
  elementId: { type: String, required: true },
  depth: { type: Number, default: 0 },
})

const store = useExplorerStore()

const entry = computed(() => store.nodes.get(props.elementId))
const node = computed(() => entry.value?.node)
const isSelected = computed(() => store.selectedId === props.elementId)
const isExpanded = computed(() => entry.value?.expanded ?? false)
const isLoading = computed(() => store.loadingChildren.has(props.elementId))
// A level, an object or a kind of data point, from the object's type.
const type = computed(() => store.typeOf(node.value))
// Until its children are read, expect them under a composition (its
// components) and under an ISA-95 level (its children). A level is not
// a composition in i3X.
const hasChildren = computed(() => {
  if (entry.value?.loaded) return entry.value.childIds.length > 0
  return (node.value?.isComposition ?? false) || type.value.kind === 'level'
})

const isVisible = computed(() => {
  if (!store.filter) return true
  return node.value?.displayName?.toLowerCase().includes(store.filter.toLowerCase())
})

function handleClick () {
  store.selectNode(props.elementId)
}

function handleToggle (e) {
  e.stopPropagation()
  store.toggleNode(props.elementId)
}
</script>

<template>
  <div v-if="isVisible">
    <div
      class="flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer text-sm hover:bg-slate-100 transition-colors"
      :class="{ 'bg-slate-200 font-medium': isSelected }"
      :style="{ paddingLeft: `${depth * 16 + 8}px` }"
      @click="handleClick"
    >
      <button
        v-if="hasChildren"
        class="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-600 shrink-0"
        @click="handleToggle"
      >
        <i
          class="fa-solid fa-chevron-right text-[10px] transition-transform duration-200"
          :class="{ 'rotate-90': isExpanded }"
        ></i>
      </button>
      <span v-else class="w-4 shrink-0"></span>

      <i class="fa-solid fa-fw text-[10px] shrink-0" :class="type.icon" :title="type.label"></i>

      <span class="truncate">{{ node?.displayName ?? elementId }}</span>

      <i v-if="isLoading" class="fa-solid fa-spinner fa-spin text-[10px] text-slate-400 ml-auto"></i>
    </div>

    <div v-if="isExpanded && entry?.childIds?.length">
      <ExplorerTreeNode
        v-for="childId in entry.childIds"
        :key="childId"
        :element-id="childId"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>
