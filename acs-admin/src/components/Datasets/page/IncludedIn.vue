<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The datasets that include this one, as far as you can see. -->
<template>
  <Card class="flex flex-col gap-2 p-4">
    <div class="font-semibold">Included in</div>
    <RouterLink v-for="id in list" :key="id" :to="`/datasets/${id}`"
                class="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50">
      <i :class="`fa-solid fa-fw fa-${kind_info(ds.byUuid[id]?.kind).icon} text-xs text-slate-500`"></i>
      <span class="truncate hover:underline">{{ ds.byUuid[id] ? ds.name(id) : 'A dataset you cannot see' }}</span>
      <span class="ml-auto text-xs text-slate-500">{{ ds.byUuid[id] ? kind_info(ds.byUuid[id].kind).label : '' }}</span>
    </RouterLink>
    <div v-if="!list.length" class="text-sm text-slate-500">Not included in any other dataset you can see.</div>
  </Card>
</template>

<script setup>
import { computed } from 'vue'
import { Card } from '@/components/ui/card'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { kind_info } from '@/lib/datasets/constants.js'
import { included_list } from './page-logic.js'

const props = defineProps({ record: { type: Object, required: true } })
const ds = useDatasetsStore()
const list = computed(() => included_list(props.record, ds.byUuid))
</script>
