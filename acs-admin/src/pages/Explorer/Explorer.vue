<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { onMounted } from 'vue'
import { useExplorerStore } from '@store/useExplorerStore.js'
import ExplorerTreeNode from './ExplorerTreeNode.vue'

const store = useExplorerStore()

onMounted(() => {
  store.loadRoots()
})
</script>

<template>
  <div class="flex h-full min-h-0">
    <!-- Left panel: Tree -->
    <div class="w-72 border-r border-border flex flex-col overflow-hidden shrink-0">
      <div class="p-3 border-b">
        <input
          v-model="store.filter"
          type="text"
          placeholder="Filter hierarchy..."
          class="w-full px-3 py-1.5 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>
      <div class="flex-1 overflow-y-auto p-2">
        <div v-if="store.loadingRoots" class="text-sm text-slate-500 p-2">Loading...</div>
        <div v-else-if="store.rootIds.length === 0" class="text-sm text-slate-500 p-2">No objects found</div>
        <div v-else>
          <ExplorerTreeNode
            v-for="id in store.rootIds"
            :key="id"
            :element-id="id"
          />
        </div>
      </div>
    </div>

    <!-- Main panel -->
    <div class="flex-1 flex flex-col overflow-y-auto p-4 gap-4">
      <div v-if="!store.selectedId" class="flex items-center justify-center h-full text-slate-400 text-sm">
        Select a node from the hierarchy to view details
      </div>
      <div v-else>
        <div class="text-sm text-slate-500">Selected: {{ store.selectedNode?.displayName }}</div>
      </div>
    </div>

    <!-- Right sidebar -->
    <div v-if="store.selectedId" class="w-96 border-l border-border hidden xl:block overflow-y-auto shrink-0">
      <div class="p-4 text-sm text-slate-500">Node detail sidebar</div>
    </div>
  </div>
</template>
