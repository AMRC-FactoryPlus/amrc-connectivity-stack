<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The Datasets page: a timeline (default) or a list of every dataset.
     The view is kept in the URL (?view=list) so it survives a reload
     and the back button. -->
<template>
  <div class="flex flex-col gap-4">
    <div v-if="ds.error" class="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
      <i class="fa-solid fa-triangle-exclamation mr-2"></i>{{ ds.error }}
    </div>

    <TimelineView v-if="view === 'timeline'">
      <template #actions><ViewActions v-model:view="view"/></template>
    </TimelineView>
    <ListView v-else>
      <template #actions><ViewActions v-model:view="view"/></template>
    </ListView>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import TimelineView from './TimelineView.vue'
import ListView from './ListView.vue'
import ViewActions from './ViewActions.vue'

const ds = useDatasetsStore()
const route = useRoute()
const router = useRouter()

const view = computed({
  get: () => route.query.view === 'list' ? 'list' : 'timeline',
  set: v => router.replace({ query: { ...route.query, view: v === 'list' ? 'list' : undefined } }),
})

onMounted(() => ds.start())
onUnmounted(() => ds.stop())
</script>
